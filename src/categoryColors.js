/** 分类展示色（避开「我方」红、「顶扫有记录」琥珀） */

const RESERVED = new Set([
  '#fef0f0',
  '#fde2e2',
  '#c45656',
  '#f56c6c',
  '#fff3bf',
  '#fde68a',
  '#f59e0b',
  '#d97706',
  '#92400e',
])

/** 常见分类固定配色 */
const PRESET = {
  空: { bg: '#f0f9eb', text: '#67c23a', border: '#c2e7b0' },
  未提取到监管码: { bg: '#ecf5ff', text: '#2563eb', border: '#93c5fd' },
  海康无记录: { bg: '#f5f3ff', text: '#7c3aed', border: '#c4b5fd' },
  监管码已被扫描过: { bg: '#ecfeff', text: '#0891b2', border: '#67e8f9' },
  数据异常: { bg: '#fff7ed', text: '#ea580c', border: '#fdba74' },
  提取到多个监管码: { bg: '#eef2ff', text: '#4f46e5', border: '#a5b4fc' },
  提取到多个物流码: { bg: '#fdf4ff', text: '#c026d3', border: '#f0abfc' },
}

const PALETTE = [
  { bg: '#f0fdfa', text: '#0f766e', border: '#5eead4' },
  { bg: '#eff6ff', text: '#1d4ed8', border: '#93c5fd' },
  { bg: '#fdf2f8', text: '#db2777', border: '#f9a8d4' },
  { bg: '#f7fee7', text: '#65a30d', border: '#bef264' },
  { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
  { bg: '#fff1f2', text: '#e11d48', border: '#fda4af' }, // rose, not 我方红底
  { bg: '#faf5ff', text: '#9333ea', border: '#d8b4fe' },
  { bg: '#fffbeb', text: '#b45309', border: '#fcd34d' }, // amber text but soft bg ≠ 顶扫
]

function hash(str) {
  let h = 0
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function categoryColor(category) {
  const cat = String(category || '').trim() || '未知'
  if (PRESET[cat]) return PRESET[cat]
  const pick = PALETTE[hash(cat) % PALETTE.length]
  // 兜底：若碰巧撞到保留色，换下一档
  if (RESERVED.has(pick.bg.toLowerCase()) || RESERVED.has(pick.text.toLowerCase())) {
    return PALETTE[(hash(cat) + 3) % PALETTE.length]
  }
  return pick
}

export function categoryTagStyle(category) {
  const c = categoryColor(category)
  return {
    backgroundColor: c.bg,
    color: c.text,
    borderColor: c.border,
  }
}

export function categoryTabStyle(category, checked) {
  const c = categoryColor(category)
  if (checked) {
    return {
      backgroundColor: c.text,
      color: '#fff',
      borderColor: c.text,
    }
  }
  return {
    backgroundColor: c.bg,
    color: c.text,
    borderColor: c.border,
  }
}

/** 整行配色用 CSS 变量（「空」不着色） */
export function categoryRowVars(category) {
  const cat = String(category || '').trim()
  if (!cat || cat === '空') return null
  const c = categoryColor(cat)
  return {
    '--row-cat-bg': c.bg,
    '--row-cat-fg': c.text,
    '--row-cat-bar': c.border,
  }
}
