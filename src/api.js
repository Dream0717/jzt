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
export const importXls = async (dayId, file) => {
  await ensureAuth()
  const form = new FormData()
  form.append('file', file)
  return request(`/api/days/${dayId}/import`, { method: 'POST', body: form })
}

/** 城市级按操作时间拆分导入；overwrite=true 时覆盖已有验收明细日期 */
export const importSplitXls = async (cityId, file, { overwrite = false } = {}) => {
  await ensureAuth()
  const form = new FormData()
  form.append('file', file)
  const q = overwrite ? '?overwrite=1' : ''
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
  if (res.status === 409 && data.need_confirm) {
    const err = new Error(data.error || '需要确认覆盖')
    err.code = 'NEED_CONFIRM'
    err.preview = data
    throw err
  }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`)
  return data
}
export const getStats = (dayId) => request(`/api/days/${dayId}/stats`)
export const listRecords = (dayId, category, keyword, page = 1, pageSize = 50) => {
  const q = new URLSearchParams({ category, keyword, page, pageSize })
  return request(`/api/days/${dayId}/records?${q}`)
}

export const getReasonOptions = (dayId) => request(`/api/days/${dayId}/reason-options`)

export const updateRecordReason = (id, reason_note) =>
  writeRequest(`/api/records/${id}/reason`, {
    method: 'PATCH',
    body: JSON.stringify({ reason_note }),
  })

export const updateProblemOwner = (id, problem_owner) =>
  writeRequest(`/api/records/${id}/problem-owner`, {
    method: 'PATCH',
    body: JSON.stringify({ problem_owner }),
  })

export const updateProblemOwnerByReason = (dayId, reason_note, problem_owner) =>
  writeRequest(`/api/days/${dayId}/problem-owner-by-reason`, {
    method: 'PATCH',
    body: JSON.stringify({ reason_note, problem_owner }),
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
