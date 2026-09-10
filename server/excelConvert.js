import * as XLSX from 'xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * 预览用：.xlsx 原样返回（保留图片）；.xls 按 GBK 转成 xlsx，避免中文乱码
 * 注意：旧版 .xls 转 xlsx 无法保留嵌入图片（格式限制）
 */
export function toPreviewXlsx(fileBuffer, fileName = 'file.xls') {
  const name = String(fileName || 'file.xls')
  if (/\.xlsx$/i.test(name)) {
    return {
      buffer: Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer),
      fileName: name,
      mime: XLSX_MIME,
      converted: false,
    }
  }

  const wb = XLSX.read(fileBuffer, {
    type: 'buffer',
    cellDates: true,
    codepage: 936,
    raw: false,
  })
  const buffer = XLSX.write(wb, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true,
  })
  return {
    buffer,
    fileName: name.replace(/\.xls$/i, '.xlsx'),
    mime: XLSX_MIME,
    converted: true,
  }
}
