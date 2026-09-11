import { reactive, watch } from 'vue'

const STORAGE_KEY = 'jzt_ding_sao_rate_by_day'

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

/** 按日期 id 记录是否开启「算上海康无记录的读码率」 */
export const dingSaoRateByDay = reactive(readStored())

watch(
  dingSaoRateByDay,
  (map) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...map }))
    } catch {
      // ignore
    }
  },
  { deep: true }
)

export function isDingSaoRateEnabled(dayId) {
  if (dayId == null || dayId === '') return false
  return !!dingSaoRateByDay[String(dayId)]
}

export function setDingSaoRateEnabled(dayId, on) {
  if (dayId == null || dayId === '') return
  const key = String(dayId)
  if (on) dingSaoRateByDay[key] = true
  else delete dingSaoRateByDay[key]
}

/** 当前城市下所有指定日期是否均已开启（用于城市「全局」开关展示） */
export function isCityDingSaoRateEnabled(dayIds) {
  const ids = (dayIds || []).map(String).filter(Boolean)
  if (!ids.length) return false
  return ids.every((id) => !!dingSaoRateByDay[id])
}

/** 批量开启/关闭城市下各日期 */
export function setCityDingSaoRateEnabled(dayIds, on) {
  for (const id of dayIds || []) {
    if (id == null || id === '') continue
    const key = String(id)
    if (on) dingSaoRateByDay[key] = true
    else delete dingSaoRateByDay[key]
  }
}

/**
 * 关闭某日读码率开关。
 * 若该城市此前「全局全开」，则级联关闭城市内全部日期。
 */
export function turnOffDingSaoRate(dayId, cityDayIds = []) {
  const ids = (cityDayIds || []).map(String).filter(Boolean)
  const wasGlobalOn = ids.length > 0 && ids.every((id) => !!dingSaoRateByDay[id])
  if (wasGlobalOn) {
    for (const id of ids) delete dingSaoRateByDay[id]
    return
  }
  if (dayId == null || dayId === '') return
  delete dingSaoRateByDay[String(dayId)]
}

export function calcScanRatePercent(total, ourMiss, hikOurMiss = 0, withDingSao = false) {
  const t = Number(total) || 0
  if (t <= 0) return null
  const miss = Number(ourMiss) || 0
  const hik = Number(hikOurMiss) || 0
  // withDingSao：另扣「海康无记录·我方」
  const num = withDingSao ? t - miss - hik : t - miss
  return Number(((num / t) * 100).toFixed(2))
}
