import XLSX from 'xlsx'

// 列名 → 字段 映射（海康统计明细）
const COLUMN_MAP = {
  单据抬头ID: 'doc_head_id',
  业务单据编号: 'doc_no',
  条码流水号: 'serial_no',
  监管码: 'drug_code',
  商品编号: 'goods_no',
  商品名称: 'goods_name',
  药品规格: 'spec',
  生产厂家: 'manufacturer',
  操作员: 'operator',
  操作时间: 'op_time',
  商品内码: 'goods_inner_no',
  补扫原因: 'raw_reason',
}

/** 把 "2.0201E+14" / "2.02e14" 展开成普通数字字符串；非科学计数法则返回 null */
function expandScientific(str) {
  const m = String(str).trim().match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/)
  if (!m) return null
  const sign = m[1] === '-' ? '-' : ''
  const digits = m[2] + (m[3] || '')
  const exp = Number(m[4])
  const pointAt = m[2].length + exp
  if (pointAt <= 0) return sign + '0.' + '0'.repeat(-pointAt) + digits
  if (pointAt >= digits.length) return sign + digits + '0'.repeat(pointAt - digits.length)
  return sign + digits.slice(0, pointAt) + '.' + digits.slice(pointAt)
}

/** 数字转纯文本整数（避免 toString 出 1.23e+15） */
function numberToPlainIntStr(n) {
  if (!Number.isFinite(n)) return ''
  const rounded = Math.round(n)
  if (Math.abs(rounded) <= Number.MAX_SAFE_INTEGER) return String(rounded)
  // 超出安全整数时精度本已丢失，仍避免科学计数法展示
  return rounded.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
}

// 需要按「标识码」处理的列：可能被 Excel 存成数字/科学计数法
const ID_FIELDS = new Set([
  'doc_head_id',
  'serial_no',
  'drug_code',
  'goods_no',
  'goods_inner_no',
  'doc_no',
])

/** 标识码列：数字→完整整数文本；科学计数法字符串→展开 */
function idCellToStr(v) {
  if (v == null || v === '') return ''
  if (typeof v === 'number') return numberToPlainIntStr(v)
  const s = String(v).trim()
  if (!s) return ''
  const expanded = expandScientific(s)
  if (expanded != null) {
    // 条码类一般为整数，去掉小数点及之后
    const intPart = expanded.replace(/^-/, '').split('.')[0]
    return (expanded.startsWith('-') ? '-' : '') + intPart
  }
  // 去掉误带的千分位逗号
  if (/^[\d,]+$/.test(s)) return s.replace(/,/g, '')
  return s
}

// 单元格统一转字符串（大数字避免科学计数法）
function cellToStr(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'number') return numberToPlainIntStr(v)
  const s = String(v).trim()
  const expanded = expandScientific(s)
  return expanded != null ? expanded.split('.')[0] : s
}

function fmtDateTime(d) {
  if (!(d instanceof Date) || isNaN(d)) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 最后一列「补扫原因」→ 分类规则：
 *  - 空白            → 空（正常扫上）
 *  - 监管码【xxx】已经被扫描过 → 监管码已被扫描过（归并明细码）
 *  - 纯数字（串行数据）→ 数据异常
 *  - 其他            → 原文（如 未提取到监管码 / 海康无记录 / 提取到多个物流码 …）
 */
export function normalizeCategory(rawReason) {
  const v = String(rawReason ?? '').trim()
  if (!v) return '空'
  if (/^监管码【.*】(已经)?被扫描过$/.test(v)) return '监管码已被扫描过'
  if (/^\d+$/.test(v)) return '数据异常'
  return v.slice(0, 255)
}

/**
 * 解析 xls/xlsx buffer → 行数组（已按表头映射 + 分类）
 */
export function parseHikDetail(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, codepage: 936 })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Excel 中没有工作表')
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })

  // 定位表头行：前 10 行内找到包含「监管码」或「补扫原因」的行
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = rows[i].map((c) => String(cellToStr(c)))
    if (cells.includes('监管码') || cells.includes('补扫原因')) {
      headerRowIdx = i
      break
    }
  }
  if (headerRowIdx === -1) throw new Error('未找到表头行（需要包含「监管码」或「补扫原因」列）')

  const header = rows[headerRowIdx].map((c) => String(cellToStr(c)).trim())
  const colField = header.map((h) => COLUMN_MAP[h] || null)

  const records = []
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every((c) => c === '' || c == null)) continue
    const rec = {}
    row.forEach((cell, idx) => {
      const field = colField[idx]
      if (!field) return
      if (field === 'op_time') {
        const v = cellToStr(cell)
        rec.op_time = v instanceof Date ? fmtDateTime(v) : null
        return
      }
      // 条码流水号等 ID 列：优先走科学计数法展开，避免 2.0201E+14
      const raw = ID_FIELDS.has(field) ? idCellToStr(cell) : cellToStr(cell)
      const maxLen = field === 'raw_reason' ? 512 : 255
      rec[field] = typeof raw === 'string' ? raw.slice(0, maxLen) : raw
    })
    // 广州等导出缺「业务单据编号」时，用单据抬头ID 顶上，方便列表展示/搜索
    if (!rec.doc_no && rec.doc_head_id) rec.doc_no = rec.doc_head_id
    if (!rec.goods_name && !rec.doc_no && !rec.drug_code) continue // 跳过完全空的行
    rec.category = normalizeCategory(rec.raw_reason)
    records.push(rec)
  }
  return records
}
