import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../data/uploads')

export async function ensureUploadRoot() {
  await fs.mkdir(path.join(UPLOAD_ROOT, 'remarks'), { recursive: true })
  await fs.mkdir(path.join(UPLOAD_ROOT, 'excels'), { recursive: true })
}

function safeExt(nameOrMime, fallback = 'bin') {
  const fromName = path.extname(String(nameOrMime || '')).replace(/^\./, '').toLowerCase()
  if (fromName && /^[a-z0-9]{1,8}$/.test(fromName)) return fromName
  const mime = String(nameOrMime || '').toLowerCase()
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('sheet') || mime.includes('spreadsheetml')) return 'xlsx'
  if (mime.includes('ms-excel')) return 'xls'
  return fallback
}

export function absPath(rel) {
  if (!rel) return null
  const full = path.resolve(UPLOAD_ROOT, rel)
  if (!full.startsWith(UPLOAD_ROOT)) throw new Error('非法文件路径')
  return full
}

export async function writeUpload(rel, buffer) {
  const full = absPath(rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, buffer)
  return rel
}

export async function readUpload(rel) {
  return fs.readFile(absPath(rel))
}

export async function removeUpload(rel) {
  if (!rel) return
  try {
    await fs.unlink(absPath(rel))
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
}

export async function removeRemarkUploads(dayId) {
  await fs.rm(path.join(UPLOAD_ROOT, 'remarks', String(dayId)), { recursive: true, force: true })
}

export async function removeExcelUploads(dayId) {
  await fs.rm(path.join(UPLOAD_ROOT, 'excels', String(dayId)), { recursive: true, force: true })
}

export async function removeDayUploads(dayId) {
  await removeRemarkUploads(dayId)
  await removeExcelUploads(dayId)
}

export function remarkRelPath(dayId, recordId, mimeOrName) {
  const ext = safeExt(mimeOrName, 'jpg')
  return `remarks/${dayId}/${recordId}.${ext}`
}

export function excelRelPath(dayId, excelId, fileName) {
  const ext = /\.xlsx$/i.test(fileName) ? 'xlsx' : /\.xls$/i.test(fileName) ? 'xls' : 'xlsx'
  return `excels/${dayId}/${excelId}.${ext}`
}
