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

export function calcScanRatePercent(total, ourMiss, dingSaoFound = 0, withDingSao = false) {
  const t = Number(total) || 0
  if (t <= 0) return null
  const miss = Number(ourMiss) || 0
  const ding = Number(dingSaoFound) || 0
  const num = withDingSao ? t - miss - ding : t - miss
  return Number(((num / t) * 100).toFixed(2))
}
