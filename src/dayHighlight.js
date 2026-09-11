const KEY = 'jzt_last_day_id'

/** 进入验收明细时记录，返回日期列表时高亮对应文件夹 */
export function rememberOpenedDay(dayId) {
  if (dayId == null || dayId === '') return
  try {
    sessionStorage.setItem(KEY, String(dayId))
  } catch {
    // ignore
  }
}

export function getOpenedDayId() {
  try {
    return sessionStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}
