import express from 'express'
import multer from 'multer'
import ExcelJS from 'exceljs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, initSchema } from './db.js'
import { parseHikDetail, groupRecordsByDate } from './importXls.js'
import { login, logout, register, requireLogin, writeAudit, ensureBootstrapUser } from './auth.js'
import { toPreviewXlsx } from './excelConvert.js'
import { decodeUploadFilename, fixStoredFilename } from './filename.js'
import {
  ensureUploadRoot,
  writeUpload,
  readUpload,
  removeUpload,
  removeDayUploads,
  removeRemarkUploads,
  remarkRelPath,
  excelRelPath,
} from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json())

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
})

const uploadRemark = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const h = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }))

/** 可设置问题归属的分类（同原因跨日期同步） */
const OWNER_CATEGORIES = new Set(['未提取到监管码', '海康无记录'])
function canSetProblemOwner(category) {
  return OWNER_CATEGORIES.has(String(category || ''))
}
function defaultProblemOwner(category) {
  return canSetProblemOwner(category) ? '我方' : null
}

const RECORD_COLS = 15
const RECORD_INSERT_SQL = `INSERT INTO scan_record
  (day_id, doc_head_id, doc_no, serial_no, drug_code, goods_no, goods_name, spec,
   manufacturer, operator, op_time, goods_inner_no, raw_reason, category, problem_owner)
  VALUES `

async function insertScanRecords(conn, dayId, records) {
  const BATCH = 500
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH).map((r) => [
      Number(dayId),
      r.doc_head_id || null,
      r.doc_no || null,
      r.serial_no || null,
      r.drug_code || null,
      r.goods_no || null,
      r.goods_name || null,
      r.spec || null,
      r.manufacturer || null,
      r.operator || null,
      r.op_time || null,
      r.goods_inner_no || null,
      r.raw_reason || null,
      r.category,
      defaultProblemOwner(r.category),
    ])
    const groups = chunk.map(() => `(${Array(RECORD_COLS).fill('?').join(',')})`).join(',')
    await conn.query(RECORD_INSERT_SQL + groups, chunk.flat())
  }
}

async function addTrashItem(conn, req, itemType, originalId, label, payload) {
  const recordRows = Array.isArray(payload?.records) ? payload.records : []
  const savedPayload = { ...(payload || {}) }
  delete savedPayload.records
  const [result] = await conn.query(
    'INSERT INTO trash_item (item_type, original_id, label, payload, deleted_by) VALUES (?, ?, ?, ?, ?)',
    [itemType, originalId || null, String(label || '').slice(0, 255), JSON.stringify(savedPayload), req.user?.username || null]
  )
  const trashId = result.insertId
  for (let i = 0; i < recordRows.length; i += 250) {
    const chunk = recordRows.slice(i, i + 250)
    const values = chunk.map(() => '(?, ?, ?, ?)').join(',')
    const params = chunk.flatMap((record) => [trashId, record.id, record.day_id, JSON.stringify(record)])
    await conn.query(`INSERT INTO trash_record (trash_id, original_record_id, original_day_id, payload) VALUES ${values}`, params)
  }
  return trashId
}

function parseTrashPayload(value) {
  if (value && typeof value === 'object') return value
  return JSON.parse(String(value || '{}'))
}

/** 读码率 = (总数 − 未提取到监管码且归属我方) ÷ 总数 × 100，保留两位小数
 *  percent_with_ding_sao 另扣「海康无记录且归属我方」
 *  ding_sao_found_count 字段现表示：海康无记录·我方 数量（兼容旧字段名）
 */
function buildScanRate(totalRaw, ourMissRaw, hikOurMissRaw = 0) {
  const total = Number(totalRaw) || 0
  const our_miss_count = Number(ourMissRaw) || 0
  const ding_sao_found_count = Number(hikOurMissRaw) || 0
  const percent = total > 0 ? Number((((total - our_miss_count) / total) * 100).toFixed(2)) : 0
  const percent_with_ding_sao =
    total > 0
      ? Number((((total - our_miss_count - ding_sao_found_count) / total) * 100).toFixed(2))
      : 0
  return { total, our_miss_count, ding_sao_found_count, percent, percent_with_ding_sao }
}

async function queryDayScanRate(dayId, conn = pool) {
  const [[rate]] = await conn.query(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN category = '未提取到监管码' AND problem_owner = '我方' THEN 1 ELSE 0 END) AS our_miss_count,
            SUM(CASE WHEN category = '海康无记录' AND problem_owner = '我方' THEN 1 ELSE 0 END) AS ding_sao_found_count
     FROM scan_record WHERE day_id = ?`,
    [dayId]
  )
  return buildScanRate(rate.total, rate.our_miss_count, rate.ding_sao_found_count)
}

/** 海康无记录：按原因给默认问题归属 */
function defaultOwnerForHikReason(reasonNote) {
  const note = String(reasonNote || '').trim()
  if (note === '顶扫有记录') return '我方'
  if (note === '顶扫无记录') return '客户'
  return null
}

// ---------- 登录 / 注册 ----------
app.post(
  '/api/login',
  h(async (req, res) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const session = await login(username, password)
    if (session?.error) return res.status(session.status || 400).json({ error: session.error })
    if (!session) return res.status(401).json({ error: '账号或密码错误' })
    await writeAudit(
      { user: { userId: session.userId, username: session.username }, headers: req.headers, socket: req.socket },
      '登录',
      null
    )
    res.json(session)
  })
)

app.post(
  '/api/register',
  h(async (req, res) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const result = await register(username, password)
    if (result.error) return res.status(result.status || 400).json({ error: result.error })
    await writeAudit(
      { user: { userId: result.userId, username: result.username }, headers: req.headers, socket: req.socket },
      '注册',
      null
    )
    res.json(result)
  })
)

app.post(
  '/api/logout',
  h(async (req, res) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    logout(token)
    res.json({ ok: true })
  })
)

app.get(
  '/api/audit-logs',
  requireLogin,
  h(async (req, res) => {
    if (req.user.username !== 'dream') return res.status(403).json({ error: '只有 dream 账号可以查看操作日志' })
    const page = Math.max(1, Number(req.query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50))
    const keyword = String(req.query.keyword || '').trim()
    const where = []
    const params = []
    if (keyword) {
      where.push('(username LIKE ? OR action LIKE ? OR detail LIKE ?)')
      const kw = `%${keyword}%`
      params.push(kw, kw, kw)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_log ${whereSql}`,
      params
    )
    const offset = (page - 1) * pageSize
    const [rows] = await pool.query(
      `SELECT id, user_id, username, action, detail, ip, created_at
       FROM audit_log ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )
    res.json({ total, page, pageSize, logs: rows })
  })
)

// ---------- 城市 ----------
app.get(
  '/api/cities',
  h(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.created_at, COUNT(d.id) AS day_count
       FROM city c LEFT JOIN acceptance_day d ON d.city_id = c.id
       GROUP BY c.id, c.name, c.created_at
       ORDER BY c.id`
    )
    res.json({ cities: rows })
  })
)

app.post(
  '/api/cities',
  requireLogin,
  h(async (req, res) => {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: '城市名称不能为空' })
    if (name.length > 50) return res.status(400).json({ error: '城市名称过长' })
    try {
      const [r] = await pool.query('INSERT INTO city (name) VALUES (?)', [name])
      await writeAudit(req, '创建城市', { name, id: r.insertId })
      res.json({ id: r.insertId, name })
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: `城市「${name}」已存在` })
      throw e
    }
  })
)

app.delete(
  '/api/cities/:id',
  requireLogin,
  h(async (req, res) => {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [[city]] = await conn.query('SELECT * FROM city WHERE id = ?', [req.params.id])
      if (!city) { await conn.rollback(); return res.status(404).json({ error: '城市不存在' }) }
      const [days] = await conn.query('SELECT * FROM acceptance_day WHERE city_id = ?', [req.params.id])
      const dayIds = days.map((day) => day.id)
      const records = dayIds.length ? (await conn.query(`SELECT * FROM scan_record WHERE day_id IN (${dayIds.map(() => '?').join(',')})`, dayIds))[0] : []
      const excels = dayIds.length ? (await conn.query(`SELECT * FROM day_excel WHERE day_id IN (${dayIds.map(() => '?').join(',')})`, dayIds))[0] : []
      await addTrashItem(conn, req, 'city', city.id, city.name, { city, days, records, excels })
      await conn.query('DELETE FROM city WHERE id = ?', [req.params.id])
      await conn.commit()
      await writeAudit(req, '移入回收站：删除城市', { id: Number(req.params.id) })
      res.json({ ok: true })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  })
)

// ---------- 日期文件夹 ----------
app.get(
  '/api/cities/:cityId/days',
  h(async (req, res) => {
    const [cities] = await pool.query('SELECT id, name FROM city WHERE id = ?', [req.params.cityId])
    if (cities.length === 0) return res.status(404).json({ error: '城市不存在' })
    const [days] = await pool.query(
      `SELECT d.id, d.day_date, d.source_type, d.manual_scan_rate, d.created_at,
              COUNT(r.id) AS record_count,
              COUNT(DISTINCT r.category) AS category_count,
              GROUP_CONCAT(DISTINCT r.category ORDER BY r.category SEPARATOR '\u0001') AS categories,
              SUM(CASE WHEN r.category = '未提取到监管码' AND r.problem_owner = '我方' THEN 1 ELSE 0 END) AS our_miss_count,
              SUM(CASE WHEN r.category = '海康无记录' AND r.problem_owner = '我方' THEN 1 ELSE 0 END) AS ding_sao_found_count,
              SUM(CASE
                    WHEN r.problem_owner = '我方'
                     AND (r.remark_image_path IS NULL OR r.remark_image_path = '')
                    THEN 1 ELSE 0
                  END) AS owner_no_remark_count,
              (SELECT COUNT(*) FROM day_excel e WHERE e.day_id = d.id) AS excel_count
       FROM acceptance_day d
       LEFT JOIN scan_record r ON r.day_id = d.id
       WHERE d.city_id = ?
       GROUP BY d.id, d.day_date, d.source_type, d.manual_scan_rate, d.created_at
       ORDER BY d.day_date ASC, d.id ASC`,
      [req.params.cityId]
    )
    res.json({
      city: cities[0],
      days: days.map((d) => ({
        ...d,
        categories: d.categories
          ? String(d.categories)
              .split('\u0001')
              .map((x) => x.trim())
              .filter(Boolean)
          : [],
      })),
    })
  })
)

app.get('/api/cities/:cityId/export-days', h(async (req, res) => {
  const ids = String(req.query.day_ids || '').split(',').map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
  if (!ids.length) return res.status(400).json({ error: '请至少选择一个日期' })
  const dingSaoIds = new Set(String(req.query.ding_sao_ids || '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0))
  const placeholders = ids.map(() => '?').join(',')
  const [cities] = await pool.query('SELECT name FROM city WHERE id = ?', [req.params.cityId])
  if (!cities.length) return res.status(404).json({ error: '城市不存在' })
  const [days] = await pool.query(`SELECT id, day_date FROM acceptance_day WHERE city_id = ? AND id IN (${placeholders}) ORDER BY day_date`, [req.params.cityId, ...ids])
  if (!days.length) return res.status(404).json({ error: '没有可导出的验收明细日期' })
  const wb = new ExcelJS.Workbook(); wb.creator = '九州通读码数据验收'
  const summary = wb.addWorksheet('良率汇总')
  summary.columns = [
    { header: '城市', key: 'city', width: 18 }, { header: '日期', key: 'date', width: 16 },
    { header: '明细总数', key: 'total', width: 14 }, { header: '未提取到监管码·我方', key: 'our_miss', width: 24 },
    { header: '海康无记录·我方计入', key: 'ding_sao', width: 22 }, { header: '良率', key: 'rate', width: 14 },
  ]
  summary.getRow(1).font = { bold: true }
  summary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9EAF7' } }
  let grandTotal = 0; let grandMiss = 0; let grandDing = 0
  for (const day of days) {
    const rate = await queryDayScanRate(day.id)
    const includeDing = dingSaoIds.has(Number(day.id))
    const dingCount = includeDing ? Number(rate.ding_sao_found_count) || 0 : 0
    const dayRate = Number(rate.total) ? `${(((Number(rate.total) - Number(rate.our_miss_count) - dingCount) / Number(rate.total)) * 100).toFixed(2)}%` : '—'
    summary.addRow({ city: cities[0].name, date: String(day.day_date).slice(0, 10), total: Number(rate.total) || 0, our_miss: Number(rate.our_miss_count) || 0, ding_sao: dingCount, rate: dayRate })
    grandTotal += Number(rate.total) || 0; grandMiss += Number(rate.our_miss_count) || 0; grandDing += dingCount
    const [rows] = await pool.query(
      `SELECT COALESCE(NULLIF(doc_no,''), doc_head_id) AS doc_no, serial_no, goods_name, spec, manufacturer, drug_code, operator, op_time, raw_reason, category, reason_note, problem_owner, remark_image_path
       FROM scan_record WHERE day_id = ? ORDER BY op_time DESC, id DESC`, [day.id]
    )
    const ws = wb.addWorksheet(String(day.day_date).slice(0, 31))
    ws.columns = [
      { header: '业务单据编号', key: 'doc_no', width: 20 }, { header: '条码流水号', key: 'serial_no', width: 22 },
      { header: '商品名称', key: 'goods_name', width: 24 }, { header: '药品规格', key: 'spec', width: 20 },
      { header: '生产厂家', key: 'manufacturer', width: 24 }, { header: '监管码', key: 'drug_code', width: 24 },
      { header: '操作员', key: 'operator', width: 14 }, { header: '操作时间', key: 'op_time', width: 20 },
      { header: '补扫原因', key: 'raw_reason', width: 24 }, { header: '分类', key: 'category', width: 20 },
      { header: '原因说明', key: 'reason_note', width: 24 }, { header: '问题归属', key: 'problem_owner', width: 12 }, { header: '备注图片', key: 'remark', width: 14 },
    ]
    ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9EAF7' } }
    for (const row of rows) {
      const excelRow = ws.addRow({ ...row, remark: row.remark_image_path ? '见图片' : '' })
      if (row.remark_image_path) {
        try {
          const image = await readUpload(row.remark_image_path)
          const imagePath = String(row.remark_image_path).toLowerCase()
          const ext = imagePath.endsWith('.png') ? 'png' : imagePath.endsWith('.gif') ? 'gif' : 'jpeg'
          if (imagePath.endsWith('.webp')) throw new Error('Excel 不支持直接嵌入 WebP')
          const imageId = wb.addImage({ buffer: image, extension: ext })
          ws.addImage(imageId, { tl: { col: 12, row: excelRow.number - 1 }, ext: { width: 90, height: 54 } })
          excelRow.height = 44
        } catch { /* 图片缺失时保留文字 */ }
      }
    }
    ws.autoFilter = { from: 'A1', to: `M${Math.max(1, ws.rowCount)}` }
  }
  const grandRate = grandTotal ? `${(((grandTotal - grandMiss - grandDing) / grandTotal) * 100).toFixed(2)}%` : '—'
  summary.addRow({ city: cities[0].name, date: '合计', total: grandTotal, our_miss: grandMiss, ding_sao: grandDing, rate: grandRate })
  summary.autoFilter = { from: 'A1', to: `F${summary.rowCount - 1}` }
  const buf = await wb.xlsx.writeBuffer()
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('验收明细导出.xlsx')}`)
  res.send(Buffer.from(buf))
}))

app.post(
  '/api/cities/:cityId/days',
  requireLogin,
  h(async (req, res) => {
    let date = String(req.body?.date || '').trim()
    if (!date) {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' })
    const sourceType = String(req.body?.source_type || '').trim()
    if (sourceType !== 'detail' && sourceType !== 'excel') {
      return res.status(400).json({ error: '请选择导入类型：验收明细或 Excel' })
    }
    try {
      const [r] = await pool.query(
        'INSERT INTO acceptance_day (city_id, day_date, source_type) VALUES (?, ?, ?)',
        [req.params.cityId, date, sourceType]
      )
      await writeAudit(req, '创建日期文件夹', { id: r.insertId, day_date: date, source_type: sourceType, city_id: Number(req.params.cityId) })
      res.json({ id: r.insertId, day_date: date, source_type: sourceType })
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: `日期「${date}」已存在` })
      if (e.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: '城市不存在' })
      throw e
    }
  })
)

app.patch(
  '/api/days/:id',
  requireLogin,
  h(async (req, res) => {
    const [rows] = await pool.query('SELECT id, source_type FROM acceptance_day WHERE id = ?', [
      req.params.id,
    ])
    if (rows.length === 0) return res.status(404).json({ error: '日期不存在' })
    if (req.body?.manual_scan_rate !== undefined) {
      const rate = String(req.body.manual_scan_rate ?? '').trim().slice(0, 32)
      await pool.query('UPDATE acceptance_day SET manual_scan_rate = ? WHERE id = ?', [
        rate || null,
        req.params.id,
      ])
      await writeAudit(req, '修改读码率', { day_id: Number(req.params.id), manual_scan_rate: rate || null })
      return res.json({ ok: true, manual_scan_rate: rate || null })
    }
    return res.status(400).json({ error: '没有可更新的字段' })
  })
)

app.delete(
  '/api/days/:id',
  requireLogin,
  h(async (req, res) => {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [[day]] = await conn.query('SELECT * FROM acceptance_day WHERE id = ?', [req.params.id])
      if (!day) {
        await conn.rollback()
        return res.status(404).json({ error: '日期不存在' })
      }
      const [records] = await conn.query('SELECT * FROM scan_record WHERE day_id = ?', [req.params.id])
      const [excels] = await conn.query('SELECT * FROM day_excel WHERE day_id = ?', [req.params.id])
      await addTrashItem(conn, req, 'day', day.id, day.day_date, { day, records, excels })
      await conn.query('DELETE FROM acceptance_day WHERE id = ?', [req.params.id])
      await conn.commit()
      await writeAudit(req, '移入回收站：删除日期文件夹', { day_id: Number(req.params.id) })
      res.json({ ok: true })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  })
)

// ---------- 回收站 ----------
app.get('/api/trash', requireLogin, h(async (req, res) => {
  const [items] = await pool.query(
    'SELECT id, item_type, original_id, label, deleted_at, deleted_by FROM trash_item ORDER BY deleted_at DESC LIMIT 200'
  )
  res.json({ items })
}))

app.post('/api/trash/:id/restore', requireLogin, h(async (req, res) => {
  const conn = await pool.getConnection()
  let committed = false
  try {
    await conn.beginTransaction()
    const [items] = await conn.query('SELECT * FROM trash_item WHERE id = ? FOR UPDATE', [req.params.id])
    if (!items.length) {
      await conn.rollback()
      return res.status(404).json({ error: '回收站项目不存在' })
    }
    const item = items[0]
    const payload = parseTrashPayload(item.payload)
    const [trashedRows] = await conn.query('SELECT payload FROM trash_record WHERE trash_id = ? ORDER BY original_record_id', [item.id])
    const trashedRecords = trashedRows.map((row) => parseTrashPayload(row.payload))
    const records = ['records', 'day', 'city'].includes(item.item_type) ? [...trashedRecords] : []

    if (item.item_type === 'city') {
      const city = payload.city
      const [conflicts] = await conn.query('SELECT id FROM city WHERE id = ? OR name = ?', [city.id, city.name])
      if (conflicts.length) {
        await conn.rollback()
        return res.status(409).json({ error: '同名城市或原城市编号已存在，无法恢复' })
      }
      await conn.query('INSERT INTO city (id, name, created_at) VALUES (?, ?, ?)', [city.id, city.name, city.created_at])
      for (const d of payload.days || []) {
        await conn.query(
          'INSERT INTO acceptance_day (id, city_id, day_date, source_type, manual_scan_rate, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [d.id, city.id, d.day_date, d.source_type, d.manual_scan_rate, d.created_at]
        )
      }
      for (const excel of payload.excels || []) {
        const cols = ['id', 'day_id', 'file_name', 'mime_type', 'file_size', 'file_path', 'created_at']
        await conn.query(`INSERT INTO day_excel (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((key) => excel[key] ?? null))
      }
    } else if (item.item_type === 'day') {
      const d = payload.day
      const [[city]] = await conn.query('SELECT id FROM city WHERE id = ?', [d.city_id])
      const [conflicts] = await conn.query(
        'SELECT id FROM acceptance_day WHERE id = ? OR (city_id = ? AND day_date = ?)',
        [d.id, d.city_id, d.day_date]
      )
      if (!city || conflicts.length) {
        await conn.rollback()
        return res.status(409).json({ error: !city ? '所属城市已删除，无法恢复' : '该日期已存在，无法恢复' })
      }
      await conn.query(
        'INSERT INTO acceptance_day (id, city_id, day_date, source_type, manual_scan_rate, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [d.id, d.city_id, d.day_date, d.source_type, d.manual_scan_rate, d.created_at]
      )
      for (const excel of payload.excels || []) {
        const cols = ['id', 'day_id', 'file_name', 'mime_type', 'file_size', 'file_path', 'created_at']
        await conn.query(
          `INSERT INTO day_excel (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map((key) => excel[key] ?? null)
        )
      }
    } else if (item.item_type === 'excel') {
      const excel = payload.excel
      const [[day]] = await conn.query('SELECT id FROM acceptance_day WHERE id = ?', [excel.day_id])
      const [conflicts] = await conn.query('SELECT id FROM day_excel WHERE id = ?', [excel.id])
      if (!day || conflicts.length) {
        await conn.rollback()
        return res.status(409).json({ error: !day ? '所属日期已删除，无法恢复' : '该 Excel 已存在，无法恢复' })
      }
      const cols = ['id', 'day_id', 'file_name', 'mime_type', 'file_size', 'file_path', 'created_at']
      await conn.query(
        `INSERT INTO day_excel (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map((key) => excel[key] ?? null)
      )
    } else if (item.item_type === 'records') {
      const [[day]] = await conn.query('SELECT id FROM acceptance_day WHERE id = ?', [payload.day_id])
      if (!day) {
        await conn.rollback()
        return res.status(409).json({ error: '所属日期已删除，无法恢复明细' })
      }
    } else {
      await conn.rollback()
      return res.status(400).json({ error: '暂不支持恢复此类项目' })
    }

    for (const record of records) {
      const cols = [
        'id', 'day_id', 'doc_head_id', 'doc_no', 'serial_no', 'drug_code', 'goods_no',
        'goods_name', 'spec', 'manufacturer', 'operator', 'op_time', 'goods_inner_no',
        'raw_reason', 'category', 'reason_note', 'remark_image_path', 'remark_image_mime',
        'problem_owner', 'created_at',
      ]
      await conn.query(
        `INSERT INTO scan_record (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        cols.map((key) => record[key] ?? null)
      )
    }

    await conn.query('DELETE FROM trash_record WHERE trash_id = ?', [req.params.id])
    await conn.query('DELETE FROM trash_item WHERE id = ?', [req.params.id])
    await conn.commit()
    committed = true
    await writeAudit(req, '恢复回收站项目', { trash_id: Number(req.params.id), item_type: item.item_type })
    res.json({ ok: true })
  } catch (e) {
    if (!committed) await conn.rollback()
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '数据已存在，无法恢复；原项目仍保留在回收站' })
    throw e
  } finally {
    conn.release()
  }
}))

app.delete('/api/trash/:id', requireLogin, h(async (req, res) => {
  const [items] = await pool.query('SELECT item_type, payload FROM trash_item WHERE id = ?', [req.params.id])
  if (!items.length) return res.status(404).json({ error: '回收站项目不存在' })
  const payload = parseTrashPayload(items[0].payload)
  const [trashRecords] = await pool.query('SELECT payload FROM trash_record WHERE trash_id = ?', [req.params.id])
  const records = trashRecords.map((row) => parseTrashPayload(row.payload))
  for (const record of records) if (record.remark_image_path) await removeUpload(record.remark_image_path)
  const excels = items[0].item_type === 'excel' ? [payload.excel] : payload.excels || []
  for (const excel of excels) if (excel?.file_path) await removeUpload(excel.file_path)
  await pool.query('DELETE FROM trash_record WHERE trash_id = ?', [req.params.id])
  const [r] = await pool.query('DELETE FROM trash_item WHERE id = ?', [req.params.id])
  if (!r.affectedRows) return res.status(404).json({ error: '回收站项目不存在' })
  await writeAudit(req, '彻底删除回收站项目', { trash_id: Number(req.params.id) })
  res.json({ ok: true })
}))

app.get(
  '/api/days/:id',
  h(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT d.id, d.city_id, d.day_date, d.source_type, d.manual_scan_rate, c.name AS city_name
       FROM acceptance_day d JOIN city c ON c.id = d.city_id
       WHERE d.id = ?`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '日期不存在' })
    res.json({
      day: rows[0],
      scan_rate: await queryDayScanRate(req.params.id),
    })
  })
)

// ---------- 导入 xls ----------
app.post(
  '/api/days/:id/import',
  requireLogin,
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择文件' })
    const [days] = await pool.query('SELECT id, source_type, day_date FROM acceptance_day WHERE id = ?', [
      req.params.id,
    ])
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })
    if (days[0].source_type === 'excel') {
      return res.status(400).json({ error: '该日期为 Excel 模式，请导入 Excel 文件' })
    }

    const records = parseHikDetail(req.file.buffer)
    const importMode = String(req.query.mode || req.body?.mode || 'overwrite').toLowerCase() === 'append' ? 'append' : 'overwrite'

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      if (importMode === 'overwrite') {
        const [previous] = await conn.query('SELECT * FROM scan_record WHERE day_id = ?', [req.params.id])
        if (previous.length) {
          await addTrashItem(conn, req, 'records', null, `${days[0].day_date} 导入覆盖前明细`, {
            day_id: Number(req.params.id),
            records: previous,
          })
        }
        await conn.query('DELETE FROM scan_record WHERE day_id = ?', [req.params.id])
      }
      if (!days[0].source_type) {
        await conn.query(`UPDATE acceptance_day SET source_type = 'detail' WHERE id = ?`, [
          req.params.id,
        ])
      }

      await insertScanRecords(conn, req.params.id, records)
      await conn.commit()
      await writeAudit(req, '导入验收明细', {
        day_id: Number(req.params.id),
        imported: records.length,
      })
      res.json({ total: records.length, imported: records.length })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  })
)

// ---------- 城市级：按操作时间拆分导入多日验收明细（支持多文件） ----------
app.post(
  '/api/cities/:cityId/import-split',
  requireLogin,
  upload.array('files', 30),
  h(async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : []
    if (files.length === 0) return res.status(400).json({ error: '请选择至少一个文件' })
    const [cities] = await pool.query('SELECT id, name FROM city WHERE id = ?', [req.params.cityId])
    if (cities.length === 0) return res.status(404).json({ error: '城市不存在' })

    const merged = new Map() // date -> records[]
    let totalParsed = 0
    let skipped = 0
    const fileSummaries = []

    for (const file of files) {
      const records = parseHikDetail(file.buffer)
      totalParsed += records.length
      const { groups, skipped: skipOne } = groupRecordsByDate(records)
      skipped += skipOne
      const perFile = []
      for (const [date, rows] of groups) {
        if (!merged.has(date)) merged.set(date, [])
        merged.get(date).push(...rows)
        perFile.push({ date, count: rows.length })
      }
      fileSummaries.push({
        file_name: decodeUploadFilename(file.originalname || 'upload.xlsx'),
        total: records.length,
        dates: perFile.sort((a, b) => a.date.localeCompare(b.date)),
      })
    }

    if (merged.size === 0) {
      return res.status(400).json({ error: '未识别到有效操作时间，无法按日期拆分' })
    }

    const dates = [...merged.keys()].sort()
    const [existingDays] = await pool.query(
      `SELECT id, DATE_FORMAT(day_date, '%Y-%m-%d') AS day_date, source_type
       FROM acceptance_day
       WHERE city_id = ? AND day_date IN (${dates.map(() => '?').join(',')})`,
      [req.params.cityId, ...dates]
    )
    const dayByDate = new Map(
      existingDays.map((d) => [d.day_date, { id: d.id, source_type: d.source_type }])
    )

    const excelConflicts = dates.filter((d) => dayByDate.get(d)?.source_type === 'excel')
    if (excelConflicts.length) {
      return res.status(400).json({
        error: `以下日期已是 Excel 模式，无法写入验收明细：${excelConflicts.join('、')}`,
      })
    }

    const importMode = String(req.query.mode || 'choose').toLowerCase()
    const wouldOverwrite = dates.filter((d) => {
      const ex = dayByDate.get(d)
      return ex && ex.source_type !== 'excel'
    })
    if (!['append', 'overwrite'].includes(importMode) && wouldOverwrite.length) {
      return res.status(409).json({
        error: '部分日期文件夹已存在，请选择追加或覆盖',
        need_mode: true,
        file_count: files.length,
        files: fileSummaries,
        dates: dates.map((date) => ({
          date,
          count: merged.get(date).length,
          exists: !!dayByDate.get(date),
          will_overwrite: wouldOverwrite.includes(date),
        })),
        total: totalParsed,
        skipped,
      })
    }

    const conn = await pool.getConnection()
    const results = []
    try {
      await conn.beginTransaction()
      for (const date of dates) {
        const dayRecords = merged.get(date)
        let dayId = dayByDate.get(date)?.id
        let created = false
        if (!dayId) {
          const [r] = await conn.query(
            `INSERT INTO acceptance_day (city_id, day_date, source_type) VALUES (?, ?, 'detail')`,
            [req.params.cityId, date]
          )
          dayId = r.insertId
          created = true
        } else {
          if (importMode === 'overwrite') {
            const [previous] = await conn.query('SELECT * FROM scan_record WHERE day_id = ?', [dayId])
            if (previous.length) {
              await addTrashItem(conn, req, 'records', null, `${date} 拆分导入覆盖前明细`, {
                day_id: Number(dayId),
                records: previous,
              })
            }
            await conn.query('DELETE FROM scan_record WHERE day_id = ?', [dayId])
          }
          await conn.query(`UPDATE acceptance_day SET source_type = 'detail' WHERE id = ?`, [dayId])
        }
        await insertScanRecords(conn, dayId, dayRecords)
        results.push({
          date,
          day_id: dayId,
          imported: dayRecords.length,
          created,
          overwritten: !created,
          appended: !created && importMode === 'append',
        })
      }
      await conn.commit()
      await writeAudit(req, '按日期拆分导入明细', {
        city_id: Number(req.params.cityId),
        file_count: files.length,
        days: results.length,
        imported: results.reduce((a, x) => a + x.imported, 0),
      })
      res.json({
        total: totalParsed,
        skipped,
        file_count: files.length,
        files: fileSummaries,
        days: results,
        imported: results.reduce((a, x) => a + x.imported, 0),
      })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  })
)

// ---------- 分类统计 ----------
app.get(
  '/api/days/:id/stats',
  h(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT category, COUNT(*) AS count
       FROM scan_record WHERE day_id = ?
       GROUP BY category
       ORDER BY (category = '空') DESC, count DESC`,
      [req.params.id]
    )
    res.json({ stats: rows })
  })
)

// ---------- 明细查询 ----------
app.get(
  '/api/days/:id/records',
  h(async (req, res) => {
    const dayId = req.params.id
    const { category, keyword, page = 1, pageSize = 50 } = req.query
    const where = ['day_id = ?']
    const params = [dayId]
    if (category) {
      where.push('category = ?')
      params.push(category)
    }
    if (keyword) {
      const kw = `%${keyword}%`
      where.push(`(
        COALESCE(NULLIF(doc_no, ''), doc_head_id) LIKE ?
        OR doc_head_id LIKE ?
        OR doc_no LIKE ?
        OR serial_no LIKE ?
        OR goods_name LIKE ?
        OR goods_no LIKE ?
        OR goods_inner_no LIKE ?
        OR spec LIKE ?
        OR manufacturer LIKE ?
        OR drug_code LIKE ?
        OR operator LIKE ?
        OR category LIKE ?
        OR raw_reason LIKE ?
        OR reason_note LIKE ?
        OR problem_owner LIKE ?
        OR CAST(op_time AS CHAR) LIKE ?
      )`)
      params.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw, kw)
    }
    const whereSql = where.join(' AND ')
    const limit = Math.min(Number(pageSize) || 50, 500)
    const offset = ((Number(page) || 1) - 1) * limit

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM scan_record WHERE ${whereSql}`, params)
    const [records] = await pool.query(
      `SELECT id,
              COALESCE(NULLIF(doc_no, ''), doc_head_id) AS doc_no,
              serial_no, goods_name, spec, manufacturer, drug_code, operator, op_time, category,
              reason_note, problem_owner,
              (remark_image_path IS NOT NULL AND remark_image_path <> '') AS has_remark_image
       FROM scan_record WHERE ${whereSql}
       ORDER BY op_time DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    res.json({ total, records })
  })
)

app.patch('/api/days/:id/records/reason', requireLogin, h(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000)
  const reasonNote = String(req.body?.reason_note ?? '').trim().slice(0, 512)
  if (!ids.length) return res.status(400).json({ error: '请先选择明细行' })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query(
      `SELECT id, category FROM scan_record WHERE day_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [req.params.id, ...ids]
    )
    const editable = rows.filter((row) => row.category !== '空')
    if (!editable.length) {
      await conn.rollback()
      return res.status(400).json({ error: '选中的记录没有可填写原因的项目' })
    }
    const editableIds = editable.map((row) => row.id)
    await conn.query(
      `UPDATE scan_record SET reason_note = ? WHERE day_id = ? AND id IN (${editableIds.map(() => '?').join(',')})`,
      [reasonNote || null, req.params.id, ...editableIds]
    )
    const ownerByCategory = {}
    if (reasonNote) {
      for (const category of new Set(editable.map((row) => row.category).filter(canSetProblemOwner))) {
        const [peers] = await conn.query(
          `SELECT problem_owner FROM scan_record WHERE category = ? AND reason_note = ?
             AND id NOT IN (${editableIds.map(() => '?').join(',')})
             AND problem_owner IN ('客户','我方') ORDER BY id ASC LIMIT 1`,
          [category, reasonNote, ...editableIds]
        )
        const owner = peers[0]?.problem_owner || (category === '海康无记录' ? defaultOwnerForHikReason(reasonNote) : null)
        if (owner) {
          ownerByCategory[category] = owner
          await conn.query(
            `UPDATE scan_record SET problem_owner = ? WHERE day_id = ? AND id IN (${editableIds.map(() => '?').join(',')}) AND category = ?`,
            [owner, req.params.id, ...editableIds, category]
          )
        }
      }
    }
    await conn.commit()
    await writeAudit(req, '多选同步填写原因', { day_id: Number(req.params.id), reason_note: reasonNote || null, affected: editableIds.length })
    const [updated] = await pool.query(
      `SELECT id, category, reason_note, problem_owner FROM scan_record WHERE day_id = ? AND id IN (${editableIds.map(() => '?').join(',')})`,
      [req.params.id, ...editableIds]
    )
    res.json({ ok: true, updated, affected: editableIds.length, skipped: rows.length - editable.length, scan_rate: await queryDayScanRate(req.params.id) })
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}))

app.post('/api/days/:id/records/trash', requireLogin, h(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 1000)
  if (!ids.length) return res.status(400).json({ error: '请先选择明细行' })
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[day]] = await conn.query('SELECT id, day_date FROM acceptance_day WHERE id = ?', [req.params.id])
    if (!day) { await conn.rollback(); return res.status(404).json({ error: '日期不存在' }) }
    const [records] = await conn.query(
      `SELECT * FROM scan_record WHERE day_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [req.params.id, ...ids]
    )
    if (!records.length) { await conn.rollback(); return res.status(404).json({ error: '未找到选中的明细' }) }
    await addTrashItem(conn, req, 'records', null, `${day.day_date} · ${records.length} 条验收明细`, { day_id: Number(day.id), records })
    await conn.query(`DELETE FROM scan_record WHERE day_id = ? AND id IN (${records.map(() => '?').join(',')})`, [req.params.id, ...records.map((r) => r.id)])
    await conn.commit()
    await writeAudit(req, '删除验收明细', { day_id: Number(req.params.id), count: records.length })
    res.json({ ok: true, deleted: records.length })
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}))

// ---------- 原因选项：按分类全局共享（跨日期） ----------
app.get(
  '/api/reason-options',
  h(async (req, res) => {
    const category = String(req.query.category || '').trim()
    if (!category || category === '空') {
      return res.json({ options: [] })
    }
    const [rows] = await pool.query(
      `SELECT reason_note,
              SUBSTRING_INDEX(
                GROUP_CONCAT(
                  CASE
                    WHEN problem_owner IN ('客户', '我方') THEN problem_owner
                    ELSE NULL
                  END
                  ORDER BY id ASC
                ),
                ',',
                1
              ) AS problem_owner
       FROM scan_record
       WHERE category = ?
         AND reason_note IS NOT NULL
         AND TRIM(reason_note) <> ''
       GROUP BY reason_note
       ORDER BY MAX(id) DESC
       LIMIT 500`,
      [category]
    )
    res.json({
      options: rows.map((r) => ({
        value: r.reason_note,
        problem_owner: r.problem_owner || null,
      })),
    })
  })
)

/** 兼容旧接口：按当前日 + 可选 category；无 category 时仍按日汇总 */
app.get(
  '/api/days/:id/reason-options',
  h(async (req, res) => {
    const category = String(req.query.category || '').trim()
    if (category && category !== '空') {
      const [rows] = await pool.query(
        `SELECT reason_note,
                SUBSTRING_INDEX(
                  GROUP_CONCAT(
                    CASE
                      WHEN problem_owner IN ('客户', '我方') THEN problem_owner
                      ELSE NULL
                    END
                    ORDER BY id ASC
                  ),
                  ',',
                  1
                ) AS problem_owner
         FROM scan_record
         WHERE category = ?
           AND reason_note IS NOT NULL
           AND TRIM(reason_note) <> ''
         GROUP BY reason_note
         ORDER BY MAX(id) DESC
         LIMIT 500`,
        [category]
      )
      return res.json({
        options: rows.map((r) => ({
          value: r.reason_note,
          problem_owner: r.problem_owner || null,
        })),
      })
    }
    const [rows] = await pool.query(
      `SELECT reason_note,
              SUBSTRING_INDEX(
                GROUP_CONCAT(
                  CASE
                    WHEN problem_owner IN ('客户', '我方') THEN problem_owner
                    ELSE NULL
                  END
                  ORDER BY id ASC
                ),
                ',',
                1
              ) AS problem_owner
       FROM scan_record
       WHERE day_id = ?
         AND reason_note IS NOT NULL
         AND TRIM(reason_note) <> ''
       GROUP BY reason_note
       ORDER BY MAX(id) DESC`,
      [req.params.id]
    )
    res.json({
      options: rows.map((r) => ({
        value: r.reason_note,
        problem_owner: r.problem_owner || null,
      })),
    })
  })
)

app.patch(
  '/api/days/:id/problem-owner-by-reason',
  requireLogin,
  h(async (req, res) => {
    const reasonNote = String(req.body?.reason_note ?? '').trim().slice(0, 512)
    const owner = String(req.body?.problem_owner ?? '').trim()
    const category = String(req.body?.category ?? '未提取到监管码').trim()
    if (!reasonNote) return res.status(400).json({ error: '原因不能为空' })
    if (owner !== '客户' && owner !== '我方') {
      return res.status(400).json({ error: '问题归属只能是「客户」或「我方」' })
    }
    if (!canSetProblemOwner(category)) {
      return res.status(400).json({ error: '该分类不支持问题归属' })
    }
    const [days] = await pool.query('SELECT id FROM acceptance_day WHERE id = ?', [req.params.id])
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })
    // 同分类 + 同原因：全局同步问题归属
    const [r] = await pool.query(
      `UPDATE scan_record
       SET problem_owner = ?
       WHERE category = ?
         AND reason_note = ?`,
      [owner, category, reasonNote]
    )
    await writeAudit(req, '按原因批量设置问题归属', {
      day_id: Number(req.params.id),
      category,
      reason_note: reasonNote,
      problem_owner: owner,
      affected: r.affectedRows,
      scope: 'global_by_category',
    })
    res.json({
      ok: true,
      affected: r.affectedRows,
      problem_owner: owner,
      scan_rate: await queryDayScanRate(req.params.id),
    })
  })
)

app.patch(
  '/api/records/:id/reason',
  requireLogin,
  h(async (req, res) => {
    const reasonNote = String(req.body?.reason_note ?? '').trim().slice(0, 512)
    const [rows] = await pool.query('SELECT id, category, day_id FROM scan_record WHERE id = ?', [
      req.params.id,
    ])
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    if (rows[0].category === '空') return res.status(400).json({ error: '正常扫码记录无需填写原因' })
    await pool.query('UPDATE scan_record SET reason_note = ? WHERE id = ?', [
      reasonNote || null,
      req.params.id,
    ])

    let suggestedOwner = null
    const category = rows[0].category
    if (reasonNote && canSetProblemOwner(category)) {
      // 同分类同原因：跨日期取已有归属并同步
      const [peers] = await pool.query(
        `SELECT problem_owner FROM scan_record
         WHERE category = ?
           AND reason_note = ?
           AND id <> ?
           AND problem_owner IN ('客户', '我方')
         ORDER BY id ASC LIMIT 1`,
        [category, reasonNote, req.params.id]
      )
      if (peers.length) {
        suggestedOwner = peers[0].problem_owner
      } else if (category === '海康无记录') {
        // 顶扫有记录→我方；顶扫无记录→客户
        suggestedOwner = defaultOwnerForHikReason(reasonNote)
      }
      if (suggestedOwner) {
        await pool.query(
          `UPDATE scan_record SET problem_owner = ?
           WHERE category = ? AND reason_note = ?`,
          [suggestedOwner, category, reasonNote]
        )
      }
    }

    await writeAudit(req, '填写原因', {
      record_id: Number(req.params.id),
      category,
      reason_note: reasonNote || null,
    })
    res.json({
      ok: true,
      reason_note: reasonNote || null,
      problem_owner: suggestedOwner,
    })
  })
)

app.patch(
  '/api/records/:id/problem-owner',
  requireLogin,
  h(async (req, res) => {
    const owner = String(req.body?.problem_owner ?? '').trim()
    if (owner !== '客户' && owner !== '我方') {
      return res.status(400).json({ error: '问题归属只能是「客户」或「我方」' })
    }
    const [rows] = await pool.query(
      'SELECT id, category, day_id, reason_note FROM scan_record WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    if (!canSetProblemOwner(rows[0].category)) {
      return res.status(400).json({ error: '仅「未提取到监管码」「海康无记录」可设置问题归属' })
    }
    const category = rows[0].category
    const reasonNote = String(rows[0].reason_note || '').trim()
    let affected = 0
    if (reasonNote) {
      // 同分类同原因：跨日期全局同步
      const [r] = await pool.query(
        `UPDATE scan_record
         SET problem_owner = ?
         WHERE category = ?
           AND reason_note = ?`,
        [owner, category, reasonNote]
      )
      affected = r.affectedRows
    } else {
      await pool.query('UPDATE scan_record SET problem_owner = ? WHERE id = ?', [owner, req.params.id])
      affected = 1
    }
    await writeAudit(req, '设置问题归属', {
      record_id: Number(req.params.id),
      category,
      problem_owner: owner,
      affected,
      reason_note: reasonNote || null,
      scope: reasonNote ? 'global_by_category' : 'single',
    })
    res.json({
      ok: true,
      problem_owner: owner,
      affected,
      reason_note: reasonNote || null,
      scan_rate: await queryDayScanRate(rows[0].day_id),
    })
  })
)

// ---------- 海康无记录：导入顶扫 log，按流水号回写原因 ----------
app.post(
  '/api/days/:id/ding-sao-log',
  requireLogin,
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择 log 文件' })
    const [days] = await pool.query('SELECT id, source_type FROM acceptance_day WHERE id = ?', [
      req.params.id,
    ])
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })
    if (days[0].source_type === 'excel') {
      return res.status(400).json({ error: '该日期为 Excel 模式' })
    }

    // 用 latin1 保留原始字节，流水号为 ASCII 数字时可无视中文编码
    const logText = Buffer.from(req.file.buffer).toString('latin1')
    if (!logText.trim()) return res.status(400).json({ error: 'log 文件为空' })

    const [rows] = await pool.query(
      `SELECT id, serial_no FROM scan_record
       WHERE day_id = ? AND category = '海康无记录'`,
      [req.params.id]
    )
    if (rows.length === 0) {
      return res.json({
        total: 0,
        found: 0,
        missing: 0,
        skipped: 0,
        message: '当前日期没有「海康无记录」数据',
      })
    }

    const foundIds = []
    const missingIds = []
    let skipped = 0
    for (const row of rows) {
      const serial = String(row.serial_no || '').trim()
      if (!serial) {
        skipped += 1
        continue
      }
      if (logText.includes(serial)) foundIds.push(row.id)
      else missingIds.push(row.id)
    }

    async function batchSetReasonAndOwner(ids, reason, owner) {
      const BATCH = 500
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH)
        await pool.query(
          `UPDATE scan_record SET reason_note = ?, problem_owner = ?
           WHERE id IN (${chunk.map(() => '?').join(',')})`,
          [reason, owner, ...chunk]
        )
      }
    }

    // 顶扫有记录 → 我方；顶扫无记录 → 客户
    await batchSetReasonAndOwner(foundIds, '顶扫有记录', '我方')
    await batchSetReasonAndOwner(missingIds, '顶扫无记录', '客户')

    await writeAudit(req, '导入顶扫log', {
      day_id: Number(req.params.id),
      found: foundIds.length,
      missing: missingIds.length,
    })
    res.json({
      total: rows.length,
      found: foundIds.length,
      missing: missingIds.length,
      skipped,
      message: `已处理 ${rows.length} 条：顶扫有记录 ${foundIds.length}，顶扫无记录 ${missingIds.length}`,
      scan_rate: await queryDayScanRate(req.params.id),
    })
  })
)

app.post(
  '/api/records/:id/remark-image',
  requireLogin,
  uploadRemark.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择图片' })
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: '仅支持图片文件' })
    }
    const [rows] = await pool.query(
      'SELECT id, category, day_id, remark_image_path FROM scan_record WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    if (rows[0].category === '空') return res.status(400).json({ error: '正常扫码记录无需上传备注' })
    await removeUpload(rows[0].remark_image_path)
    const rel = remarkRelPath(rows[0].day_id, req.params.id, req.file.mimetype)
    await writeUpload(rel, req.file.buffer)
    await pool.query(
      'UPDATE scan_record SET remark_image_path = ?, remark_image_mime = ? WHERE id = ?',
      [rel, req.file.mimetype, req.params.id]
    )
    await writeAudit(req, '上传备注图片', { record_id: Number(req.params.id) })
    res.json({ ok: true, has_remark_image: true })
  })
)

app.get(
  '/api/records/:id/remark-image',
  h(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT remark_image_path, remark_image_mime FROM scan_record WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0 || !rows[0].remark_image_path) {
      return res.status(404).json({ error: '暂无备注图片' })
    }
    const buf = await readUpload(rows[0].remark_image_path)
    res.set('Content-Type', rows[0].remark_image_mime || 'image/jpeg')
    res.set('Cache-Control', 'no-cache')
    res.send(buf)
  })
)

app.delete(
  '/api/records/:id/remark-image',
  requireLogin,
  h(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT id, remark_image_path FROM scan_record WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    await removeUpload(rows[0].remark_image_path)
    await pool.query(
      'UPDATE scan_record SET remark_image_path = NULL, remark_image_mime = NULL WHERE id = ?',
      [req.params.id]
    )
    await writeAudit(req, '删除备注图片', { record_id: Number(req.params.id) })
    res.json({ ok: true })
  })
)

// ---------- 日期文件夹 Excel 附件（Univer 浏览） ----------
app.get(
  '/api/days/:id/excels',
  h(async (req, res) => {
    const [days] = await pool.query(
      `SELECT d.id, d.day_date, d.city_id, c.name AS city_name
       FROM acceptance_day d JOIN city c ON c.id = d.city_id
       WHERE d.id = ?`,
      [req.params.id]
    )
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })
    const [files] = await pool.query(
      `SELECT id, file_name, mime_type, file_size, created_at
       FROM day_excel WHERE day_id = ?
       ORDER BY id DESC`,
      [req.params.id]
    )
    res.json({
      day: days[0],
      files: files.map((f) => ({ ...f, file_name: fixStoredFilename(f.file_name) })),
    })
  })
)

app.post(
  '/api/days/:id/excels',
  requireLogin,
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择 Excel 文件' })
    const clientName = String(req.body?.filename || '').trim()
    const fileName = clientName || decodeUploadFilename(req.file.originalname)
    if (!/\.(xls|xlsx)$/i.test(fileName)) {
      return res.status(400).json({ error: '仅支持 .xls / .xlsx' })
    }
    const [days] = await pool.query('SELECT id, source_type FROM acceptance_day WHERE id = ?', [
      req.params.id,
    ])
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })
    if (days[0].source_type === 'detail') {
      return res.status(400).json({ error: '该日期为验收明细模式，请导入统计明细' })
    }

    const overwrite = String(req.body?.overwrite || '') === '1'
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      if (overwrite) {
        const [oldFiles] = await conn.query('SELECT * FROM day_excel WHERE day_id = ?', [
          req.params.id,
        ])
        for (const f of oldFiles) {
          await addTrashItem(conn, req, 'excel', f.id, f.file_name, { excel: f })
        }
        await conn.query('DELETE FROM day_excel WHERE day_id = ?', [req.params.id])
      }
      if (!days[0].source_type) {
        await conn.query(`UPDATE acceptance_day SET source_type = 'excel' WHERE id = ?`, [
          req.params.id,
        ])
      }
      const [r] = await conn.query(
        `INSERT INTO day_excel (day_id, file_name, mime_type, file_size, file_path)
         VALUES (?, ?, ?, ?, ?)`,
        [
          req.params.id,
          fileName,
          req.file.mimetype || 'application/vnd.ms-excel',
          req.file.size,
          'pending',
        ]
      )
      const rel = excelRelPath(req.params.id, r.insertId, fileName)
      await writeUpload(rel, req.file.buffer)
      await conn.query('UPDATE day_excel SET file_path = ? WHERE id = ?', [rel, r.insertId])
      await conn.commit()
      await writeAudit(req, '上传Excel', {
        day_id: Number(req.params.id),
        excel_id: r.insertId,
        file_name: fileName,
        overwritten: overwrite,
      })
      res.json({
        id: r.insertId,
        file_name: fileName,
        file_size: req.file.size,
        overwritten: overwrite,
      })
    } catch (e) {
      await conn.rollback()
      throw e
    } finally {
      conn.release()
    }
  })
)

app.get(
  '/api/excels/:id',
  h(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT e.id, e.day_id, e.file_name, e.mime_type, e.file_size, e.created_at,
              d.day_date, d.city_id, c.name AS city_name
       FROM day_excel e
       JOIN acceptance_day d ON d.id = e.day_id
       JOIN city c ON c.id = d.city_id
       WHERE e.id = ?`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Excel 不存在' })
    const excel = rows[0]
    excel.file_name = fixStoredFilename(excel.file_name)
    res.json({ excel })
  })
)

app.get(
  '/api/excels/:id/file',
  h(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT file_name, mime_type, file_path FROM day_excel WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0 || !rows[0].file_path) {
      return res.status(404).json({ error: 'Excel 不存在' })
    }
    const buf = await readUpload(rows[0].file_path)
    const name = encodeURIComponent(fixStoredFilename(rows[0].file_name || 'file.xlsx'))
    const asDownload = String(req.query.download || '') === '1'
    res.set('Content-Type', rows[0].mime_type || 'application/octet-stream')
    res.set(
      'Content-Disposition',
      `${asDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`
    )
    res.send(buf)
  })
)

/** 预览专用：xlsx 原样（含图片）；xls 转 xlsx 并按 GBK 解码中文 */
app.get(
  '/api/excels/:id/preview',
  h(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT file_name, file_path FROM day_excel WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0 || !rows[0].file_path) {
      return res.status(404).json({ error: 'Excel 不存在' })
    }
    const fileData = await readUpload(rows[0].file_path)
    const preview = toPreviewXlsx(fileData, fixStoredFilename(rows[0].file_name))
    const name = encodeURIComponent(preview.fileName)
    res.set('Content-Type', preview.mime)
    res.set('X-Excel-Converted', preview.converted ? '1' : '0')
    res.set('Content-Disposition', `inline; filename*=UTF-8''${name}`)
    res.send(preview.buffer)
  })
)

/** 保存编辑后的 Excel 内容（覆盖原文件二进制） */
app.put(
  '/api/excels/:id/content',
  requireLogin,
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '缺少文件内容' })
    const clientName = String(req.body?.filename || '').trim()
    const [rows] = await pool.query(
      'SELECT id, day_id, file_name, file_path FROM day_excel WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Excel 不存在' })
    let fileName = clientName || fixStoredFilename(rows[0].file_name)
    if (!/\.xlsx$/i.test(fileName)) {
      fileName = fileName.replace(/\.(xls)?$/i, '') + '.xlsx'
    }
    const rel = excelRelPath(rows[0].day_id, req.params.id, fileName)
    if (rows[0].file_path && rows[0].file_path !== rel) {
      await removeUpload(rows[0].file_path)
    }
    await writeUpload(rel, req.file.buffer)
    await pool.query(
      `UPDATE day_excel
       SET file_name = ?, mime_type = ?, file_size = ?, file_path = ?
       WHERE id = ?`,
      [
        fileName,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        req.file.size,
        rel,
        req.params.id,
      ]
    )
    await writeAudit(req, '保存Excel', {
      excel_id: Number(req.params.id),
      file_name: fileName,
    })
    res.json({ ok: true, file_name: fileName, file_size: req.file.size })
  })
)

app.delete(
  '/api/excels/:id',
  requireLogin,
  h(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM day_excel WHERE id = ?', [
      req.params.id,
    ])
    if (rows.length === 0) return res.status(404).json({ error: 'Excel 不存在' })
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await addTrashItem(conn, req, 'excel', rows[0].id, rows[0].file_name, { excel: rows[0] })
      await conn.query('DELETE FROM day_excel WHERE id = ?', [req.params.id])
      await conn.commit()
    } catch (e) {
      await conn.rollback(); throw e
    } finally { conn.release() }
    await writeAudit(req, '移入回收站：删除Excel', { excel_id: Number(req.params.id) })
    res.json({ ok: true })
  })
)

const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
app.get(/^\/(?!api).*/, (req, res, next) => {
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next()
  })
})

const PORT = process.env.API_PORT || process.env.PORT || 3001
ensureUploadRoot()
  .then(() => initSchema())
  .then(() => ensureBootstrapUser())
  .then(() => {
    app.listen(PORT, () => console.log(`[api] ready on http://localhost:${PORT}`))
  })
  .catch((e) => {
    console.error('[api] failed to start', e)
    process.exit(1)
  })
