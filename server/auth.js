import crypto from 'crypto'
import { pool } from './db.js'

/** token -> { userId, username, createdAt } */
const sessions = new Map()

/** 账号：2–32 位，中文/字母/数字/下划线 */
export function validateUsername(username) {
  const u = String(username || '').trim()
  if (!u) return '请输入账号'
  if (u.length < 2 || u.length > 32) return '账号长度为 2–32 个字符'
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_]+$/.test(u)) {
    return '账号仅允许中文、字母、数字和下划线'
  }
  return null
}

/** 密码：4–64 位，禁止空白与控制字符 */
export function validatePassword(password) {
  const p = String(password ?? '')
  if (!p) return '请输入密码'
  if (p.length < 4 || p.length > 64) return '密码长度为 4–64 个字符'
  if (/[\s\x00-\x1f\x7f]/.test(p)) return '密码不能包含空格或非法控制字符'
  return null
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  if (!stored || !String(stored).includes(':')) return false
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const next = crypto.scryptSync(String(password), salt, 64)
  const prev = Buffer.from(hash, 'hex')
  if (prev.length !== next.length) return false
  return crypto.timingSafeEqual(prev, next)
}

export async function ensureBootstrapUser() {
  const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM app_user')
  if (Number(row.c) > 0) return
  const username = String(process.env.AUTH_USER || 'dream').trim() || 'dream'
  const password = String(process.env.AUTH_PASSWORD || 'dream') || 'dream'
  await pool.query('INSERT INTO app_user (username, password_hash) VALUES (?, ?)', [
    username,
    hashPassword(password),
  ])
  console.log(`[auth] 已初始化默认账号: ${username}`)
}

export async function register(username, password) {
  const uErr = validateUsername(username)
  if (uErr) return { error: uErr, status: 400 }
  const pErr = validatePassword(password)
  if (pErr) return { error: pErr, status: 400 }
  const name = String(username).trim()
  try {
    const [r] = await pool.query('INSERT INTO app_user (username, password_hash) VALUES (?, ?)', [
      name,
      hashPassword(password),
    ])
    return createSession(r.insertId, name)
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return { error: '账号已存在', status: 409 }
    throw e
  }
}

export async function login(username, password) {
  const name = String(username || '').trim()
  const pass = String(password ?? '')
  if (!name || !pass) return null
  const [rows] = await pool.query(
    'SELECT id, username, password_hash FROM app_user WHERE username = ? LIMIT 1',
    [name]
  )
  if (!rows.length) return null
  if (!verifyPassword(pass, rows[0].password_hash)) return null
  return createSession(rows[0].id, rows[0].username)
}

function createSession(userId, username) {
  const token = crypto.randomBytes(24).toString('hex')
  const session = { userId, username, createdAt: Date.now() }
  sessions.set(token, session)
  return { token, username, userId }
}

export function logout(token) {
  if (token) sessions.delete(token)
}

export function getSession(token) {
  if (!token) return null
  return sessions.get(token) || null
}

export function requireLogin(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const session = getSession(token)
  if (!session) {
    return res.status(401).json({ error: '请先登录后再修改数据' })
  }
  req.user = session
  next()
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return xf || req.socket?.remoteAddress || ''
}

export async function writeAudit(req, action, detail = null) {
  try {
    const username = req.user?.username || 'anonymous'
    const userId = req.user?.userId || null
    const text =
      detail == null
        ? null
        : typeof detail === 'string'
          ? detail.slice(0, 2000)
          : JSON.stringify(detail).slice(0, 2000)
    await pool.query(
      `INSERT INTO audit_log (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)`,
      [userId, username, String(action).slice(0, 128), text, clientIp(req).slice(0, 64)]
    )
  } catch (e) {
    console.warn('[audit]', e.message)
  }
}
