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
export const createDay = (cityId, date) =>
  writeRequest(`/api/cities/${cityId}/days`, {
    method: 'POST',
    body: JSON.stringify({ date }),
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
export const getStats = (dayId) => request(`/api/days/${dayId}/stats`)
export const listRecords = (dayId, category, keyword, page = 1, pageSize = 50) => {
  const q = new URLSearchParams({ category, keyword, page, pageSize })
  return request(`/api/days/${dayId}/records?${q}`)
}

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
