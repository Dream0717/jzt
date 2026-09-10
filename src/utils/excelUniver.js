import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'

const CellValueType = { STRING: 1, NUMBER: 2, BOOLEAN: 3 }

/** ArrayBuffer/Buffer → Univer IWorkbookData（无图回退路径） */
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

/** Univer snapshot → 纯单元格 xlsx（不含图） */
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

/**
 * 在原始 xlsx 上只更新单元格，尽量保留嵌入图片/绘图。
 * 非 zip 格式（旧 .xls）则新建文件并尝试写回 images。
 */
export async function snapshotToXlsxKeepingImages(snapshot, originalBuffer, images = []) {
  const isZip = looksLikeZip(originalBuffer)
  if (isZip) {
    try {
      return await mergeCellsIntoOriginal(snapshot, originalBuffer)
    } catch (e) {
      console.warn('[excel] merge into original failed, fallback', e)
    }
  }
  return await buildXlsxWithImages(snapshot, images)
}

function looksLikeZip(buffer) {
  if (!buffer) return false
  const u8 = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer)
  return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b
}

async function mergeCellsIntoOriginal(snapshot, originalBuffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(originalBuffer)

  const order = snapshot?.sheetOrder || Object.keys(snapshot?.sheets || {})
  for (const sheetId of order) {
    const sheet = snapshot.sheets?.[sheetId]
    if (!sheet) continue
    const name = (sheet.name || sheetId).slice(0, 31)
    let ws = wb.getWorksheet(name)
    if (!ws) {
      // 按顺序兜底匹配
      const idx = order.indexOf(sheetId)
      ws = wb.worksheets[idx] || wb.addWorksheet(name)
    }
    applyCellDataToWorksheet(ws, sheet.cellData || {})
  }

  const out = await wb.xlsx.writeBuffer()
  return out instanceof ArrayBuffer ? out : out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}

async function buildXlsxWithImages(snapshot, images) {
  const wb = new ExcelJS.Workbook()
  const order = snapshot?.sheetOrder || Object.keys(snapshot?.sheets || {})
  const sheetMap = {}

  for (const sheetId of order) {
    const sheet = snapshot.sheets?.[sheetId]
    if (!sheet) continue
    const name = (sheet.name || sheetId).slice(0, 31)
    const ws = wb.addWorksheet(name)
    applyCellDataToWorksheet(ws, sheet.cellData || {})
    sheetMap[sheetId] = ws
    sheetMap[name] = ws
  }
  if (!wb.worksheets.length) wb.addWorksheet('Sheet1')

  for (const img of images || []) {
    try {
      const ws = sheetMap[img.sheetId] || sheetMap[img.sheetName]
      if (!ws || !img.source) continue
      const { base64, extension } = parseImageSource(img.source)
      if (!base64) continue
      const imageId = wb.addImage({ base64, extension })
      const col = Number(img.position?.column ?? 0)
      const row = Number(img.position?.row ?? 0)
      const colOff = Number(img.position?.columnOffset ?? 0) / 96 // ExcelJS uses EMUs via native; tl uses cell fractions
      const rowOff = Number(img.position?.rowOffset ?? 0) / 20
      ws.addImage(imageId, {
        tl: { col: col + Math.min(colOff, 0.9), row: row + Math.min(rowOff, 0.9) },
        ext: {
          width: Math.max(Number(img.size?.width) || 120, 20),
          height: Math.max(Number(img.size?.height) || 120, 20),
        },
      })
    } catch (e) {
      console.warn('[excel] skip image on export', e)
    }
  }

  const out = await wb.xlsx.writeBuffer()
  return out instanceof ArrayBuffer ? out : out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
}

function applyCellDataToWorksheet(ws, cellData) {
  const aoa = cellDataToAoa(cellData)
  // 清空已有值（不动图片）
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.value = null
    })
  })
  aoa.forEach((rowVals, r) => {
    rowVals.forEach((val, c) => {
      if (val === '' || val == null) return
      ws.getCell(r + 1, c + 1).value = val
    })
  })
}

function parseImageSource(source) {
  const s = String(source || '')
  const m = /^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/i.exec(s)
  if (m) {
    let ext = m[1].toLowerCase()
    if (ext === 'jpeg') ext = 'jpg'
    if (!['png', 'jpg', 'gif', 'webp'].includes(ext)) ext = 'png'
    return { base64: m[2], extension: ext }
  }
  // 纯 base64
  if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 64) {
    return { base64: s.replace(/\s+/g, ''), extension: 'png' }
  }
  return { base64: '', extension: 'png' }
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
