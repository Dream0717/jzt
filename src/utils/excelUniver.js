import * as XLSX from 'xlsx'

const CellValueType = { STRING: 1, NUMBER: 2, BOOLEAN: 3 }

/** ArrayBuffer/Buffer → Univer IWorkbookData */
export function excelBufferToWorkbookData(buffer, fileName = 'Workbook') {
  const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  const wb = XLSX.read(data, { type: 'array', cellDates: true, codepage: 936 })
  const sheets = {}
  const sheetOrder = []

  wb.SheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name]
    if (!ws) return
    const sheetId = `sheet-${idx + 1}`
    sheetOrder.push(sheetId)
    sheets[sheetId] = worksheetToSheetData(ws, name, sheetId)
  })

  if (!sheetOrder.length) {
    const sheetId = 'sheet-1'
    sheetOrder.push(sheetId)
    sheets[sheetId] = emptySheet(sheetId, 'Sheet1')
  }

  return {
    id: 'workbook-1',
    name: String(fileName || 'Workbook').replace(/\.(xlsx?|csv)$/i, ''),
    appVersion: '0.25.1',
    sheets,
    sheetOrder,
    locale: 'zhCN',
  }
}

/** Univer workbook snapshot → xlsx ArrayBuffer */
export function snapshotToXlsxArrayBuffer(snapshot) {
  const wb = XLSX.utils.book_new()
  const order = snapshot?.sheetOrder || Object.keys(snapshot?.sheets || {})
  for (const sheetId of order) {
    const sheet = snapshot.sheets?.[sheetId]
    if (!sheet) continue
    const aoa = cellDataToAoa(sheet.cellData || {})
    const ws = XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['']])
    const name = (sheet.name || sheetId).slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  if (!wb.SheetNames.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['']]), 'Sheet1')
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true })
}

function emptySheet(id, name) {
  return { id, name, cellData: {}, rowCount: 100, columnCount: 20 }
}

function worksheetToSheetData(ws, name, sheetId) {
  const ref = ws['!ref']
  if (!ref) return emptySheet(sheetId, name)
  const range = XLSX.utils.decode_range(ref)
  const cellData = {}
  let maxR = range.e.r
  let maxC = range.e.c

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[addr]
      if (!cell || cell.v == null || cell.v === '') continue
      if (!cellData[R]) cellData[R] = {}
      cellData[R][C] = toUniverCell(cell)
      if (R > maxR) maxR = R
      if (C > maxC) maxC = C
    }
  }

  return {
    id: sheetId,
    name: name || sheetId,
    cellData,
    rowCount: Math.max(maxR + 20, 50),
    columnCount: Math.max(maxC + 5, 20),
  }
}

function toUniverCell(cell) {
  const v = cell.v
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0')
    const text = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`
    return { v: text, t: CellValueType.STRING }
  }
  if (typeof v === 'number') return { v, t: CellValueType.NUMBER }
  if (typeof v === 'boolean') return { v, t: CellValueType.BOOLEAN }
  // 优先原始值字符串，避免用科学计数法格式文本
  return { v: String(v), t: CellValueType.STRING }
}

function cellDataToAoa(cellData) {
  let maxR = 0
  let maxC = 0
  for (const r of Object.keys(cellData)) {
    const ri = Number(r)
    if (ri > maxR) maxR = ri
    for (const c of Object.keys(cellData[r] || {})) {
      const ci = Number(c)
      if (ci > maxC) maxC = ci
    }
  }
  const aoa = []
  for (let r = 0; r <= maxR; r++) {
    const row = []
    for (let c = 0; c <= maxC; c++) {
      const cell = cellData[r]?.[c]
      row.push(cell?.v ?? '')
    }
    aoa.push(row)
  }
  return aoa
}
