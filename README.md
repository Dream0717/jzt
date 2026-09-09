# 九州通读码数据验收

按城市 → 日期文件夹管理海康读码统计明细，导入 xls 后按最后一列「补扫原因」自动分类（空 / 未提取到监管码 / 海康无记录 / 监管码已被扫描过 / 提取到多个物流码 …），支持分类筛选、关键字搜索和分页浏览。

## 技术栈

- 前端：Vite 5 + Vue 3 + Vue Router（hash 模式），集成 [vite-mcp](https://github.com/broisnischal/vite-mcp) 插件
- 后端：Express + mysql2，multer 接收文件上传，xlsx 解析 xls/xlsx
- 数据库：MySQL 8（启动时自动建库建表）

## 启动

```bash
npm install
npm run dev   # 同时启动 Vite(5173) 和 API(3001)
```

打开 http://localhost:5173

数据库连接配置在 `.env`（DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME），首次启动自动创建 `jzt_acceptance` 库及 `city` / `acceptance_day` / `scan_record` 三张表。

## 数据表

- `city`：城市（名称唯一）
- `acceptance_day`：日期文件夹（城市内日期唯一），删除城市/日期时级联删除数据
- `scan_record`：读码明细，含 `raw_reason`（补扫原因原文）与 `category`（归并后分类）

## 分类规则（normalizeCategory）

| 补扫原因原文 | 归类 |
|---|---|
| 空白 | 空（正常扫码） |
| 监管码【xxx】已经被扫描过 | 监管码已被扫描过 |
| 纯数字 | 数据异常 |
| 其他（未提取到监管码 / 海康无记录 / 提取到多个物流码…） | 按原文 |

## vite-mcp

开发模式下插件在 `http://localhost:5173/__mcp` 暴露 MCP 服务（浏览器控制台 / 存储 / 组件树等适配器），已在 `.zcode/config.json` 中注册为 `vite-dev-mcp`，ZCode 打开本工作区即自动连接。

## API 一览

```
GET    /api/cities                      城市列表（含日期数）
POST   /api/cities                      新建城市 {name}
DELETE /api/cities/:id                  删除城市（级联）
GET    /api/cities/:cityId/days         日期列表（含记录数/分类数）
POST   /api/cities/:cityId/days         新建日期 {date}，缺省当天
DELETE /api/days/:id                    删除日期（级联）
GET    /api/days/:id                    日期详情
POST   /api/days/:id/import             导入 xls/xlsx（multipart，重新导入先清空）
GET    /api/days/:id/stats              分类统计
GET    /api/days/:id/records            明细 ?category=&keyword=&page=&pageSize=
```
