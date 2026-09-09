async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`)
  }
  return data
}

// 城市
export const listCities = () => request('/api/cities')
export const createCity = (name) =>
  request('/api/cities', { method: 'POST', body: JSON.stringify({ name }) })
export const deleteCity = (id) => request(`/api/cities/${id}`, { method: 'DELETE' })

// 日期文件夹
export const listDays = (cityId) => request(`/api/cities/${cityId}/days`)
export const createDay = (cityId, date) =>
  request(`/api/cities/${cityId}/days`, { method: 'POST', body: JSON.stringify({ date }) })
export const deleteDay = (dayId) => request(`/api/days/${dayId}`, { method: 'DELETE' })

// 某天的数据
export const getDay = (dayId) => request(`/api/days/${dayId}`)
export const importXls = (dayId, file) => {
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
  request(`/api/records/${id}/reason`, {
    method: 'PATCH',
    body: JSON.stringify({ reason_note }),
  })

export const updateProblemOwner = (id, problem_owner) =>
  request(`/api/records/${id}/problem-owner`, {
    method: 'PATCH',
    body: JSON.stringify({ problem_owner }),
  })

export const uploadRemarkImage = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return request(`/api/records/${id}/remark-image`, { method: 'POST', body: form })
}

export const deleteRemarkImage = (id) =>
  request(`/api/records/${id}/remark-image`, { method: 'DELETE' })

export const remarkImageUrl = (id, version = '') =>
  `/api/records/${id}/remark-image${version ? `?v=${version}` : ''}`
