import { ref, watch } from 'vue'

const STORAGE_KEY = 'jzt_include_ding_sao_in_rate'

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 全局：是否按「算上海康无记录」方式计算读码率（localStorage 持久化） */
export const includeDingSaoInRate = ref(readStored())

watch(includeDingSaoInRate, (on) => {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // ignore
  }
})

export function calcScanRatePercent(total, ourMiss, dingSaoFound = 0, withDingSao = false) {
  const t = Number(total) || 0
  if (t <= 0) return null
  const miss = Number(ourMiss) || 0
  const ding = Number(dingSaoFound) || 0
  const num = withDingSao ? t - miss - ding : t - miss
  return Number(((num / t) * 100).toFixed(2))
}
