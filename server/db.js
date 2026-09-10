import 'dotenv/config'
import mysql from 'mysql2/promise'

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jzt_acceptance',
  multipleStatements: false,
  charset: 'utf8mb4',
  dateStrings: true,
}

export const pool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 10 })

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS city (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS acceptance_day (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_id INT NOT NULL,
    day_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_city_date (city_id, day_date),
    CONSTRAINT fk_day_city FOREIGN KEY (city_id) REFERENCES city(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS scan_record (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    day_id INT NOT NULL,
    doc_head_id VARCHAR(64) DEFAULT NULL,
    doc_no VARCHAR(64) DEFAULT NULL,
    serial_no VARCHAR(64) DEFAULT NULL,
    drug_code VARCHAR(255) DEFAULT NULL,
    goods_no VARCHAR(64) DEFAULT NULL,
    goods_name VARCHAR(255) DEFAULT NULL,
    spec VARCHAR(255) DEFAULT NULL,
    manufacturer VARCHAR(255) DEFAULT NULL,
    operator VARCHAR(64) DEFAULT NULL,
    op_time DATETIME DEFAULT NULL,
    goods_inner_no VARCHAR(64) DEFAULT NULL,
    raw_reason VARCHAR(512) DEFAULT NULL,
    category VARCHAR(255) NOT NULL DEFAULT '其他',
    reason_note VARCHAR(512) DEFAULT NULL,
    remark_image MEDIUMBLOB DEFAULT NULL,
    remark_image_mime VARCHAR(64) DEFAULT NULL,
    problem_owner VARCHAR(16) DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_day_cat (day_id, category),
    KEY idx_day_goods (day_id, goods_name),
    KEY idx_day_code (day_id, drug_code),
    CONSTRAINT fk_rec_day FOREIGN KEY (day_id) REFERENCES acceptance_day(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS day_excel (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    day_id INT NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(128) DEFAULT NULL,
    file_size INT NOT NULL DEFAULT 0,
    file_data LONGBLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_day_excel (day_id),
    CONSTRAINT fk_excel_day FOREIGN KEY (day_id) REFERENCES acceptance_day(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
]

// 已有库升级：CREATE IF NOT EXISTS 不会改列宽，需显式 ALTER
const MIGRATE_SQL = [
  `ALTER TABLE scan_record MODIFY COLUMN serial_no VARCHAR(64) DEFAULT NULL`,
  `ALTER TABLE scan_record MODIFY COLUMN drug_code VARCHAR(255) DEFAULT NULL`,
  `ALTER TABLE scan_record MODIFY COLUMN spec VARCHAR(255) DEFAULT NULL`,
  `ALTER TABLE scan_record MODIFY COLUMN raw_reason VARCHAR(512) DEFAULT NULL`,
  `ALTER TABLE scan_record MODIFY COLUMN category VARCHAR(255) NOT NULL DEFAULT '其他'`,
  `ALTER TABLE scan_record ADD COLUMN reason_note VARCHAR(512) DEFAULT NULL`,
  `ALTER TABLE scan_record ADD COLUMN remark_image MEDIUMBLOB DEFAULT NULL`,
  `ALTER TABLE scan_record ADD COLUMN remark_image_mime VARCHAR(64) DEFAULT NULL`,
  `ALTER TABLE scan_record ADD COLUMN problem_owner VARCHAR(16) DEFAULT NULL`,
  `UPDATE scan_record SET problem_owner = '我方' WHERE category = '未提取到监管码' AND (problem_owner IS NULL OR problem_owner = '')`,
]

export async function initSchema() {
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    multipleStatements: false,
  })
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  )
  await conn.end()
  for (const sql of SCHEMA_SQL) {
    await pool.query(sql)
  }
  for (const sql of MIGRATE_SQL) {
    try {
      await pool.query(sql)
    } catch (e) {
      // 表尚未创建或列已是目标类型时忽略
      if (e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_DUP_FIELDNAME') {
        console.warn('[db] migrate skip:', e.message)
      }
    }
  }
}
