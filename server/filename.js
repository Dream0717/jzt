/** 修复 multer 在 Windows 下中文文件名被当成 latin1 的问题 */
export function decodeUploadFilename(name, fallback = 'file.xlsx') {
  const raw = String(name || '').trim()
  if (!raw) return fallback
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8')
    // 解码后含中文，或原串明显是乱码时采用解码结果
    if (/[\u4e00-\u9fff]/.test(decoded) || /Ã.|æ.|å.|ä.|ç.|ø.|þ./i.test(raw)) {
      return decoded
    }
  } catch {
    // ignore
  }
  return raw
}

/** 读取库中可能已乱码的文件名并尽量还原 */
export function fixStoredFilename(name) {
  return decodeUploadFilename(name, name || 'file.xlsx')
}
