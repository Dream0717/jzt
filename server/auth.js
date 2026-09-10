import crypto from 'crypto'

const AUTH_USER = process.env.AUTH_USER || 'dream'
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'dream'

/** token -> { username, createdAt } */
const sessions = new Map()

export function login(username, password) {
  if (username !== AUTH_USER || password !== AUTH_PASSWORD) {
    return null
  }
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, { username, createdAt: Date.now() })
  return { token, username }
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
