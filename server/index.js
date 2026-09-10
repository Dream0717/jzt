import express from 'express'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, initSchema } from './db.js'
import { parseHikDetail } from './importXls.js'
import { login, logout, requireLogin } from './auth.js'
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

/** 读码率 = (总数 − 未提取到监管码且归属我方) ÷ 总数 × 100，保留两位小数 */
function buildScanRate(totalRaw, ourMissRaw) {
  const total = Number(totalRaw) || 0
  const our_miss_count = Number(ourMissRaw) || 0
  const percent = total > 0 ? Number((((total - our_miss_count) / total) * 100).toFixed(2)) : 0
  return { total, our_miss_count, percent }
}

// ---------- 登录 ----------
app.post(
  '/api/login',
  h(async (req, res) => {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const session = login(username, password)
    if (!session) return res.status(401).json({ error: '账号或密码错误' })
    res.json(session)
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
    const [days] = await pool.query('SELECT id FROM acceptance_day WHERE city_id = ?', [
      req.params.id,
    ])
    for (const day of days) {
      await removeDayUploads(day.id)
    }
    const [r] = await pool.query('DELETE FROM city WHERE id = ?', [req.params.id])
    if (r.affectedRows === 0) return res.status(404).json({ error: '城市不存在' })
    res.json({ ok: true })
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
              SUM(CASE WHEN r.category = '未提取到监管码' AND r.problem_owner = '我方' THEN 1 ELSE 0 END) AS our_miss_count,
              (SELECT COUNT(*) FROM day_excel e WHERE e.day_id = d.id) AS excel_count
       FROM acceptance_day d
       LEFT JOIN scan_record r ON r.day_id = d.id
       WHERE d.city_id = ?
       GROUP BY d.id, d.day_date, d.source_type, d.manual_scan_rate, d.created_at
       ORDER BY d.day_date DESC, d.id DESC`,
      [req.params.cityId]
    )
    res.json({ city: cities[0], days })
  })
)

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
      return res.json({ ok: true, manual_scan_rate: rate || null })
    }
    return res.status(400).json({ error: '没有可更新的字段' })
  })
)

app.delete(
  '/api/days/:id',
  requireLogin,
  h(async (req, res) => {
    await removeDayUploads(req.params.id)
    const [r] = await pool.query('DELETE FROM acceptance_day WHERE id = ?', [req.params.id])
    if (r.affectedRows === 0) return res.status(404).json({ error: '日期不存在' })
    res.json({ ok: true })
  })
)

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
    const [[rate]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category = '未提取到监管码' AND problem_owner = '我方' THEN 1 ELSE 0 END) AS our_miss_count
       FROM scan_record WHERE day_id = ?`,
      [req.params.id]
    )
    res.json({
      day: rows[0],
      scan_rate: buildScanRate(rate.total, rate.our_miss_count),
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
    const [days] = await pool.query('SELECT id, source_type FROM acceptance_day WHERE id = ?', [
      req.params.id,
    ])
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })
    if (days[0].source_type === 'excel') {
      return res.status(400).json({ error: '该日期为 Excel 模式，请导入 Excel 文件' })
    }

    const records = parseHikDetail(req.file.buffer)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await removeRemarkUploads(req.params.id)
      await conn.query('DELETE FROM scan_record WHERE day_id = ?', [req.params.id])
      if (!days[0].source_type) {
        await conn.query(`UPDATE acceptance_day SET source_type = 'detail' WHERE id = ?`, [
          req.params.id,
        ])
      }

      const COLS = 15
      const sql = `INSERT INTO scan_record
        (day_id, doc_head_id, doc_no, serial_no, drug_code, goods_no, goods_name, spec,
         manufacturer, operator, op_time, goods_inner_no, raw_reason, category, problem_owner)
        VALUES `
      const BATCH = 500
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH).map((r) => [
          Number(req.params.id),
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
          r.category === '未提取到监管码' ? '我方' : null,
        ])
        const groups = chunk.map(() => `(${Array(COLS).fill('?').join(',')})`).join(',')
        await conn.query(sql + groups, chunk.flat()) // 手动展开多行占位符，mysql2 对嵌套数组展开不可靠
      }
      await conn.commit()
      res.json({ total: records.length, imported: records.length })
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
      where.push('(goods_name LIKE ? OR drug_code LIKE ? OR doc_no LIKE ? OR operator LIKE ?)')
      params.push(kw, kw, kw, kw)
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

// ---------- 单条记录：原因 / 备注图片 ----------
app.patch(
  '/api/records/:id/reason',
  requireLogin,
  h(async (req, res) => {
    const reasonNote = String(req.body?.reason_note ?? '').trim().slice(0, 512)
    const [rows] = await pool.query('SELECT id, category FROM scan_record WHERE id = ?', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    if (rows[0].category === '空') return res.status(400).json({ error: '正常扫码记录无需填写原因' })
    await pool.query('UPDATE scan_record SET reason_note = ? WHERE id = ?', [
      reasonNote || null,
      req.params.id,
    ])
    res.json({ ok: true, reason_note: reasonNote || null })
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
    const [rows] = await pool.query('SELECT id, category, day_id FROM scan_record WHERE id = ?', [
      req.params.id,
    ])
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    if (rows[0].category !== '未提取到监管码') {
      return res.status(400).json({ error: '仅「未提取到监管码」可设置问题归属' })
    }
    await pool.query('UPDATE scan_record SET problem_owner = ? WHERE id = ?', [owner, req.params.id])
    const [[rate]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category = '未提取到监管码' AND problem_owner = '我方' THEN 1 ELSE 0 END) AS our_miss_count
       FROM scan_record WHERE day_id = ?`,
      [rows[0].day_id]
    )
    res.json({
      ok: true,
      problem_owner: owner,
      scan_rate: buildScanRate(rate.total, rate.our_miss_count),
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
        const [oldFiles] = await conn.query('SELECT file_path FROM day_excel WHERE day_id = ?', [
          req.params.id,
        ])
        for (const f of oldFiles) {
          await removeUpload(f.file_path)
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
    res.json({ ok: true, file_name: fileName, file_size: req.file.size })
  })
)

app.delete(
  '/api/excels/:id',
  requireLogin,
  h(async (req, res) => {
    const [rows] = await pool.query('SELECT id, file_path FROM day_excel WHERE id = ?', [
      req.params.id,
    ])
    if (rows.length === 0) return res.status(404).json({ error: 'Excel 不存在' })
    await removeUpload(rows[0].file_path)
    await pool.query('DELETE FROM day_excel WHERE id = ?', [req.params.id])
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
  .then(() => {
    app.listen(PORT, () => console.log(`[api] ready on http://localhost:${PORT}`))
  })
  .catch((e) => {
    console.error('[api] failed to start', e)
    process.exit(1)
  })
