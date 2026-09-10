import * as XLSX from 'xlsx'

/** Univer CellValueType：STRING=1 NUMBER=2 BOOLEAN=3 */
const CellValueType = { STRING: 1, NUMBER: 2, BOOLEAN: 3 }

/**
 * 将 xls/xlsx ArrayBuffer 转为 Univer IWorkbookData
 */
export function excelBufferToWorkbookData(buffer, fileName = 'Workbook') {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true, codepage: 936 })
  const sheets = {}
  const sheetOrder = []

  wb.SheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name]
    if (!ws) return
    const sheetId = `sheet-${idx + 1}`
    sheetOrder.push(sheetId)
    sheets[sheetId] = worksheetToSheetData(ws, name, sheetId)
  })

  if (sheetOrder.length === 0) {
    const sheetId = 'sheet-1'
    sheetOrder.push(sheetId)
    sheets[sheetId] = {
      id: sheetId,
      name: 'Sheet1',
      cellData: {},
      rowCount: 100,
      columnCount: 20,
    }
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

function worksheetToSheetData(ws, name, sheetId) {
  const ref = ws['!ref']
  if (!ref) {
    return { id: sheetId, name, cellData: {}, rowCount: 100, columnCount: 20 }
  }
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
  if (typeof v === 'number') {
    return { v, t: CellValueType.NUMBER }
  }
  if (typeof v === 'boolean') {
    return { v, t: CellValueType.BOOLEAN }
  }
  // 大数字 / 文本：优先用格式化文本，避免科学计数法展示
  const text = cell.w != null && cell.w !== '' ? String(cell.w) : String(v)
  return { v: text, t: CellValueType.STRING }
}
