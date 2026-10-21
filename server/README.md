# 后端

Koa 2，前缀 `/api`，默认 `http://127.0.0.1:8780`。数据在 MySQL，连接来自本目录 `.env`。页面要的列表和保存走这里。风险暴露权重的计算不在这里，在 `agent/`。

生成接口前先看根目录 `README.md`。新路由加在 `src/index.js`，查询可以留在该文件；一段逻辑超过一个路由时，拆到 `src/` 下的新文件，由 `index.js` 引入。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/index.js` | 全部 HTTP 路由，以及行数据到 JSON 的形状。 |
| `src/db.js` | 读取 `.env`，导出 `query(sql, params)`。 |
| `src/measure.js` | `GET /measure` 和审计底稿。模拟债项在 `data/`，计量在 `lib/`，分类规则读 `agent/subagents/weight/knowledge/权重法风险暴露分类.json`，EAD 规则读 `agent/subagents/ead/knowledge/` 的两个配置。 |
| `src/paper.js` | `GET /working-paper` 和上传样例。底稿读 `agent/subagents/weight/paper/底稿模型计算.json`，样例读 `data/data.js`。 |
| `src/eadConfig.js` | `GET`/`PUT /ead-config`。读写 `agent/subagents/ead/knowledge/` 的两个 EAD 配置 JSON，产品类型和标准字段查 `product_type`、`product_field`。 |
| `lib/` | 计量流水线 `pipeline.cjs`、`engine.cjs`，以及审计底稿用的 `xlsx-writer.cjs`。 |
| `data/` | 模拟主数据、模拟债项、上传样例和种子规则原文。 |
| `.env.example` | 数据库变量名。真实密码只写在 `.env`。 |
| `../sql/001_schema.sql` | 建库建表。先执行这一份。 |
| `../sql/002_seed.sql` | 初始数据。由 `tools/build-seed.mjs` 生成，不要手改大段内容。 |

## 路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | 存活检查。 |
| GET | `/bootstrap` | 客户、机构、地区、版本。给前端 Vuex。 |
| GET | `/dashboard` | 总览数字。 |
| GET | `/rule-versions`、`/clauses`、`/params` | 规则版本、条款、共用参数。参数用 `PUT /params/:id` 修改。 |
| GET | `/products`、`/products/:code/fields`、`/field-mappings` | 产品、标准字段、字段映射。 |
| GET | `/exposure-class`、`/weights`、`/crm`、`/product-rules` | 暴露分类、权重表、缓释、产品专属规则。 |
| GET、PUT | `/ead-config` | 表内外 EAD 计算配置。读写 `agent/subagents/ead/knowledge/` 的两个 JSON；保存前用 `product_type`、`product_field` 校验产品 code 和标准字段，对不上就报错不写。 |
| POST | `/ead-trial` | 用现有 `computeEad` 试算一条规则。 | 
| GET | `/ccf` | 转换系数。 |
| GET、POST | `/batches`、`/batches/:id/lines` | 计量批次和明细。 |
| GET | `/measure`、`/working-paper`、`/upload-samples`、`/audit.xlsx` | 31 笔模拟计量、信用风险底稿缓存、上传样例、审计工作簿。 |
| GET | `/assistant` | 规则助手历史。 |
| POST | `/agent/chat` | 原样转发到 Flask `8766`。这里不实现智能体。 |
| POST | `/rules/chat` | 原样转发到 Flask 的规则对话。 |

成功时响应体就是数据。失败时 `{ "error": "原因" }`，并带上相应状态码。

## 表

`jurisdiction`、`customer`、`org_unit` 是客户和机构。`rule_version`、`clause_doc`、`clause_ref`、`rule_param` 是规则版本、条款和共用参数。`product_type`、`product_field`、`field_mapping` 是产品和字段。`exposure_document` 存权重法分类 JSON。`weight_rule`、`bank_grade_row`、`mo_weight_row` 是权重表。`ccf_rule`、`crm_rule`、`product_exposure_rule` 是转换系数、缓释和产品规则。`measure_batch`、`measure_line` 是批次和逐笔结果。`assistant_turn` 是规则助手对话。

`ead_rule` 表还在，但已经不灌种子数据。表内 / 表外 EAD 计算规则的唯一数据源是 `agent/subagents/ead/knowledge/` 下的两个配置文件，由 `src/eadConfig.js` 直接读写，不走这张表。

新表写进 `sql/001_schema.sql`，并在文件开头的 `DROP TABLE` 里按依赖顺序补上。种子数据需要跟着变时，改 `tools/build-seed.mjs` 再生成 `002_seed.sql`。

## 写接口时以哪个文件为准

列名只来自 `sql/001_schema.sql`。写 `SELECT` 之前打开这张表的 `CREATE TABLE`，没有的列不要出现。

响应键只在本路由的 `ctx.body` 里定义一次。对照 `GET /products`：库列 `rule_version` 写成 `ruleVersion`，`description` 写成 `desc`，`source_system` 写成 `system`。页面若要新键，先改这里的映射，不要在 Vue 里读一个还没返回的名字。

日期用文件顶部的 `date()`，JSON 列用 `json()`。参数用 `query(sql, [占位值])`。`query` 定义在 `src/db.js`，不要再创建连接池。

`/measure` 的笔数和金额由 `src/measure.js` 算出来。不要在路由或页面里写死另一套合计。`/working-paper` 只读 `agent/subagents/weight/paper/底稿模型计算.json`，不要在请求里重算。

## 加一个接口

1. 在 `src/index.js` 增加路由。查询用 `query`，参数用占位符，不要拼接 SQL。
2. 返回给页面的字段用驼峰。库里的下划线只留在 SQL 里。
3. 日期用已有的 `date()`，JSON 列用已有的 `json()`。
4. 前端到 `client/src/api/` 加函数，路径不要再写一遍 `/api`，`request` 已经带了前缀。函数路径必须和刚加的路由一致。
5. 计算权重、跑工作簿、派子智能体，不要写进 Koa。那是 `agent/` 的事。
