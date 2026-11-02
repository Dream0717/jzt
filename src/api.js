import {
  token,
  ensureAuth,
  clearSession,
  setSession,
  logoutLocal,
} from './auth.js'

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (token.value) {
    headers.Authorization = `Bearer ${token.value}`
  }

  const res = await fetch(url, { ...options, headers })
  const data = await res.json().catch(() => ({}))

  if (res.status === 401) {
    clearSession()
    throw new Error(data.error || '请先登录后再修改数据')
  }
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`)
  }
  return data
}

async function writeRequest(url, options = {}) {
  await ensureAuth()
  return request(url, options)
}

export async function login(username, password) {
  const data = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setSession(data.token, data.username)
  return data
}

export async function register(username, password) {
  const data = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setSession(data.token, data.username)
  return data
}

export const listAuditLogs = ({ page = 1, pageSize = 50, keyword = '' } = {}) => {
  const q = new URLSearchParams({ page, pageSize, keyword })
  return request(`/api/audit-logs?${q}`)
}
export const listReasonCategories = () => request('/api/reason-categories')
export const listReasonCategoryData = (category, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v))
  return request(`/api/reason-categories/${encodeURIComponent(category)}/data?${q}`)
}
export const updateReasonCategorySetting = (category, warnNoRemark) =>
  writeRequest(`/api/reason-categories/${encodeURIComponent(category)}`, {
    method: 'PATCH',
    body: JSON.stringify({ warn_no_remark: !!warnNoRemark }),
  })

export async function logout() {
  try {
    if (token.value) {
      await request('/api/logout', { method: 'POST' })
    }
  } catch {
    // 忽略退出接口失败
  }
  logoutLocal()
}

// 城市
export const listCities = () => request('/api/cities')
export const createCity = (name) =>
  writeRequest('/api/cities', { method: 'POST', body: JSON.stringify({ name }) })
export const deleteCity = (id) => writeRequest(`/api/cities/${id}`, { method: 'DELETE' })
export const updateSunloginCode = (id, code) =>
  writeRequest(`/api/cities/${id}/sunlogin-code`, { method: 'PATCH', body: JSON.stringify({ sunlogin_code: code }) })

// 日期文件夹
export const listDays = (cityId) => request(`/api/cities/${cityId}/days`)
export const createDay = (cityId, date, sourceType) =>
  writeRequest(`/api/cities/${cityId}/days`, {
    method: 'POST',
    body: JSON.stringify({ date, source_type: sourceType }),
  })
export const updateDay = (dayId, patch) =>
  writeRequest(`/api/days/${dayId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
export const deleteDay = (dayId) => writeRequest(`/api/days/${dayId}`, { method: 'DELETE' })

// 某天的数据
export const getDay = (dayId) => request(`/api/days/${dayId}`)
export const importXls = async (dayId, file, { mode = 'overwrite' } = {}) => {
  await ensureAuth()
  const form = new FormData()
  form.append('file', file)
  return request(`/api/days/${dayId}/import?mode=${encodeURIComponent(mode)}`, { method: 'POST', body: form })
}

/** 城市级按操作时间拆分导入（可多文件）；overwrite=true 时覆盖已有验收明细日期 */
export const importSplitXls = async (cityId, files, { mode = 'choose' } = {}) => {
  await ensureAuth()
  const list = Array.isArray(files) ? files : [files]
  const form = new FormData()
  for (const f of list) form.append('files', f)
  const q = `?mode=${encodeURIComponent(mode)}`
  const headers = {}
  if (token.value) headers.Authorization = `Bearer ${token.value}`
  const res = await fetch(`/api/cities/${cityId}/import-split${q}`, {
    method: 'POST',
    headers,
    body: form,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    clearSession()
    throw new Error(data.error || '请先登录后再修改数据')
  }
  if (res.status === 409 && (data.need_confirm || data.need_mode)) {
    const err = new Error(data.error || '需要确认覆盖')
    err.code = data.need_mode ? 'NEED_MODE' : 'NEED_CONFIRM'
    err.preview = data
    throw err
  }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`)
  return data
}
export const getStats = (dayId) => request(`/api/days/${dayId}/stats`)
export const getCityAggregate = (cityId, dayIds) => {
  const q = new URLSearchParams({ day_ids: (dayIds || []).join(',') })
  return request(`/api/cities/${cityId}/aggregate?${q}`)
}
export async function exportCityDays(cityId, dayIds, dingSaoIds = []) {
  await ensureAuth()
  const q = new URLSearchParams({ day_ids: (dayIds || []).join(','), ding_sao_ids: (dingSaoIds || []).join(',') })
  const res = await fetch(`/api/cities/${cityId}/export-days?${q}`, { headers: token.value ? { Authorization: `Bearer ${token.value}` } : {} })
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `导出失败 (${res.status})`) }
  return res.blob()
}
export const listTrash = () => request('/api/trash')
export const restoreTrash = (id) => writeRequest(`/api/trash/${id}/restore`, { method: 'POST' })
export const purgeTrash = (id) => writeRequest(`/api/trash/${id}`, { method: 'DELETE' })
export const listRecords = (dayId, category, keyword, page = 1, pageSize = 50) => {
  const q = new URLSearchParams({ category, keyword, page, pageSize })
  return request(`/api/days/${dayId}/records?${q}`)
}

export const getReasonOptions = (category) => {
  const q = new URLSearchParams({ category: category || '' })
  return request(`/api/reason-options?${q}`)
}

/** 海康无记录：导入顶扫 log，按流水号回写原因 */
export const matchDingSaoLog = async (dayId, file) => {
  await ensureAuth()
  const form = new FormData()
  form.append('file', file)
  return request(`/api/days/${dayId}/ding-sao-log`, { method: 'POST', body: form })
}

export const updateRecordReason = (id, reason_note) =>
  writeRequest(`/api/records/${id}/reason`, {
    method: 'PATCH',
    body: JSON.stringify({ reason_note }),
  })
export const updateRecordsReason = (dayId, ids, reason_note) =>
  writeRequest(`/api/days/${dayId}/records/reason`, {
    method: 'PATCH',
    body: JSON.stringify({ ids, reason_note }),
  })
export const trashRecords = (dayId, ids) =>
  writeRequest(`/api/days/${dayId}/records/trash`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })

export const updateProblemOwner = (id, problem_owner) =>
  writeRequest(`/api/records/${id}/problem-owner`, {
    method: 'PATCH',
    body: JSON.stringify({ problem_owner }),
  })

export const updateProblemOwnerByReason = (dayId, reason_note, problem_owner, category = '未提取到监管码') =>
  writeRequest(`/api/days/${dayId}/problem-owner-by-reason`, {
    method: 'PATCH',
    body: JSON.stringify({ reason_note, problem_owner, category }),
  })

export const uploadRemarkImage = async (id, file) => {
  await ensureAuth()
  const form = new FormData()
  form.append('file', file)
  return request(`/api/records/${id}/remark-image`, { method: 'POST', body: form })
}

export const deleteRemarkImage = (id) =>
  writeRequest(`/api/records/${id}/remark-image`, { method: 'DELETE' })

export const remarkImageUrl = (id, version = '') =>
  `/api/records/${id}/remark-image${version ? `?v=${version}` : ''}`

// 日期文件夹 Excel 附件
export const listDayExcels = (dayId) => request(`/api/days/${dayId}/excels`)

export const uploadDayExcel = async (dayId, file, { overwrite = false } = {}) => {
  await ensureAuth()
  const form = new FormData()
  form.append('file', file)
  form.append('filename', file.name || 'file.xlsx')
  form.append('overwrite', overwrite ? '1' : '0')
  return request(`/api/days/${dayId}/excels`, { method: 'POST', body: form })
}

export const getExcelMeta = (id) => request(`/api/excels/${id}`)

export async function fetchExcelBuffer(id, { preview = false, download = false } = {}) {
  const headers = {}
  if (token.value) headers.Authorization = `Bearer ${token.value}`
  let url = `/api/excels/${id}/file`
  if (preview) url = `/api/excels/${id}/preview`
  else if (download) url = `/api/excels/${id}/file?download=1`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `下载失败 (${res.status})`)
  }
  return {
    buffer: await res.arrayBuffer(),
    converted: res.headers.get('X-Excel-Converted') === '1',
    contentType: res.headers.get('Content-Type') || '',
  }
}

export const saveExcelContent = async (id, arrayBuffer, fileName) => {
  await ensureAuth()
  const form = new FormData()
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  form.append('file', blob, fileName || 'edited.xlsx')
  form.append('filename', fileName || 'edited.xlsx')
  return request(`/api/excels/${id}/content`, { method: 'PUT', body: form })
}

export const deleteExcel = (id) => writeRequest(`/api/excels/${id}`, { method: 'DELETE' })
