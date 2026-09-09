import express from 'express'
import multer from 'multer'
import { pool, initSchema } from './db.js'
import { parseHikDetail } from './importXls.js'

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
  h(async (req, res) => {
    const [r] = await pool.query('DELETE FROM city WHERE id = ?', [req.params.id])
    if (r.affectedRows === 0) return res.status(404).json({ error: '城市不存在' })
    res.json({ ok: true }) // 级联删除其日期与记录
  })
)

// ---------- 日期文件夹 ----------
app.get(
  '/api/cities/:cityId/days',
  h(async (req, res) => {
    const [cities] = await pool.query('SELECT id, name FROM city WHERE id = ?', [req.params.cityId])
    if (cities.length === 0) return res.status(404).json({ error: '城市不存在' })
    const [days] = await pool.query(
      `SELECT d.id, d.day_date, d.created_at,
              COUNT(r.id) AS record_count,
              COUNT(DISTINCT r.category) AS category_count,
              SUM(CASE WHEN r.category = '未提取到监管码' AND r.problem_owner = '客户' THEN 1 ELSE 0 END) AS customer_miss_count
       FROM acceptance_day d
       LEFT JOIN scan_record r ON r.day_id = d.id
       WHERE d.city_id = ?
       GROUP BY d.id, d.day_date, d.created_at
       ORDER BY d.day_date DESC, d.id DESC`,
      [req.params.cityId]
    )
    res.json({ city: cities[0], days })
  })
)

app.post(
  '/api/cities/:cityId/days',
  h(async (req, res) => {
    let date = String(req.body?.date || '').trim()
    if (!date) {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` // 默认当天
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' })
    try {
      const [r] = await pool.query(
        'INSERT INTO acceptance_day (city_id, day_date) VALUES (?, ?)',
        [req.params.cityId, date]
      )
      res.json({ id: r.insertId, day_date: date })
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: `日期「${date}」已存在` })
      if (e.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: '城市不存在' })
      throw e
    }
  })
)

app.delete(
  '/api/days/:id',
  h(async (req, res) => {
    const [r] = await pool.query('DELETE FROM acceptance_day WHERE id = ?', [req.params.id])
    if (r.affectedRows === 0) return res.status(404).json({ error: '日期不存在' })
    res.json({ ok: true })
  })
)

app.get(
  '/api/days/:id',
  h(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT d.id, d.city_id, d.day_date, c.name AS city_name
       FROM acceptance_day d JOIN city c ON c.id = d.city_id
       WHERE d.id = ?`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: '日期不存在' })
    const [[rate]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category = '未提取到监管码' AND problem_owner = '客户' THEN 1 ELSE 0 END) AS customer_miss_count
       FROM scan_record WHERE day_id = ?`,
      [req.params.id]
    )
    res.json({
      day: rows[0],
      scan_rate: {
        total: Number(rate.total) || 0,
        customer_miss_count: Number(rate.customer_miss_count) || 0,
        ok: Math.max(0, (Number(rate.total) || 0) - (Number(rate.customer_miss_count) || 0)),
      },
    })
  })
)

// ---------- 导入 xls ----------
app.post(
  '/api/days/:id/import',
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择文件' })
    const [days] = await pool.query('SELECT id FROM acceptance_day WHERE id = ?', [req.params.id])
    if (days.length === 0) return res.status(404).json({ error: '日期不存在' })

    const records = parseHikDetail(req.file.buffer)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      // 重新导入 = 先清空当天旧数据
      await conn.query('DELETE FROM scan_record WHERE day_id = ?', [req.params.id])

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
              (remark_image IS NOT NULL) AS has_remark_image
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
              SUM(CASE WHEN category = '未提取到监管码' AND problem_owner = '客户' THEN 1 ELSE 0 END) AS customer_miss_count
       FROM scan_record WHERE day_id = ?`,
      [rows[0].day_id]
    )
    res.json({
      ok: true,
      problem_owner: owner,
      scan_rate: {
        total: Number(rate.total) || 0,
        customer_miss_count: Number(rate.customer_miss_count) || 0,
        ok: Math.max(0, (Number(rate.total) || 0) - (Number(rate.customer_miss_count) || 0)),
      },
    })
  })
)

app.post(
  '/api/records/:id/remark-image',
  uploadRemark.single('file'),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择图片' })
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: '仅支持图片文件' })
    }
    const [rows] = await pool.query('SELECT id, category FROM scan_record WHERE id = ?', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: '记录不存在' })
    if (rows[0].category === '空') return res.status(400).json({ error: '正常扫码记录无需上传备注' })
    await pool.query(
      'UPDATE scan_record SET remark_image = ?, remark_image_mime = ? WHERE id = ?',
      [req.file.buffer, req.file.mimetype, req.params.id]
    )
    res.json({ ok: true, has_remark_image: true })
  })
)

app.get(
  '/api/records/:id/remark-image',
  h(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT remark_image, remark_image_mime FROM scan_record WHERE id = ?',
      [req.params.id]
    )
    if (rows.length === 0 || !rows[0].remark_image) {
      return res.status(404).json({ error: '暂无备注图片' })
    }
    res.set('Content-Type', rows[0].remark_image_mime || 'image/jpeg')
    res.set('Cache-Control', 'no-cache')
    res.send(rows[0].remark_image)
  })
)

app.delete(
  '/api/records/:id/remark-image',
  h(async (req, res) => {
    const [r] = await pool.query(
      'UPDATE scan_record SET remark_image = NULL, remark_image_mime = NULL WHERE id = ?',
      [req.params.id]
    )
    if (r.affectedRows === 0) return res.status(404).json({ error: '记录不存在' })
    res.json({ ok: true })
  })
)

const PORT = process.env.API_PORT || 3001
initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`[api] ready on http://localhost:${PORT}`))
  })
  .catch((e) => {
    console.error('[api] 数据库连接/初始化失败：', e.message)
    console.error('[api] 请检查项目根目录 .env 中的 DB_USER / DB_PASSWORD 配置')
    process.exit(1)
  })
