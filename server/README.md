# 后端

Koa 2，前缀 `/api`，默认 `http://127.0.0.1:8780`。数据在 MySQL，连接来自本目录 `.env`。页面要的列表和保存走这里。风险暴露权重的计算不在这里，在 `agent/`。

生成接口前先看根目录 `README.md`。新路由加在 `src/index.js`，查询可以留在该文件；一段逻辑超过一个路由时，拆到 `src/` 下的新文件，由 `index.js` 引入。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/index.js` | 全部 HTTP 路由，以及行数据到 JSON 的形状。 |
| `src/ruleWrite.js` | 规则配置的新增、修改、删除和批量删除：版本、条款、参数、产品、字段、映射、权重、转换系数、缓释规则、专属规则。 |
| `src/exposureDocs.js` | 从 `exposure_document` 读页签分类（`seq > 0`）：通用、贷款、债券，以及后来新增的页签。确认写入也写回这张表。页签可以删除，标签为「通用」的那一页不能删。每个产品的决策树对话仍在仓库根目录 `决策树对话.json`。 |
| `src/db.js` | 读取 `.env`，导出 `query(sql, params)`。 |
| `src/measure.js` | `GET /measure`、`POST /measure/workbook`、`GET /measure/workbook.xlsx`、`POST /measure/runs` 和审计底稿。模拟债项在 `data/`，上传的 xlsx 用本机 Python 的 openpyxl 读。计量在 `lib/`。分类规则读 `exposure_document` 的 `id = 1`，EAD 读 `ead_product_config`、`ead_product_rule`，缓释读 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`。跑完写入 `measure_batch.rules_json` 和 `measure_line.detail`。上传的工作簿会在原表每一行后面写上风险权重、EAD、RWA 和计算过程，`GET /measure/workbook.xlsx?uploadId=` 下载这份写回的文件。 |
| `src/paper.js` | `GET /working-paper` 和上传样例。底稿读 `agent/subagents/weight/paper/底稿模型计算.json`，样例读 `data/data.js`。 |
| `src/eadConfig.js` | `GET`/`PUT /ead-config` 和 `POST /ead-formula/check`。读写 `ead_product_config`、`ead_product_rule`，产品清单查 `product_type`，公式校验用 `lib/formula.cjs`。 |
| `src/crmConfig.js` | `GET`/`PUT /crm-config`。读写 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`，产品清单查 `product_type`，可绑定的源表列从 `product_field` 的 `source_field` 推导（计算字段和占位符不算）。 |
| `lib/formula.cjs` | EAD 公式的词法、语法分析、校验和求值。页面和计算共用这一份。 |
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
| GET、POST、PUT、DELETE | `/rule-versions`、`/clauses`、`/params` | 规则版本、条款、共用参数。写入在 `src/ruleWrite.js`。编号创建后不改。版本被产品、EAD、专属规则或计量批次引用时不能删。条款被专属规则或 EAD 规则引用时不能删。参数被银行评级档、转换系数或 EAD 规则引用时不能删。另有 `POST /rule-versions/batch-delete`、`POST /clauses/batch-delete`、`POST /params/batch-delete`，请求体 `{ "ids": [] }`，返回 `{ deleted, blocked }`。被引用的留在 `blocked`。 |
| GET、POST、PUT、DELETE | `/products`、`/products/:code/fields`、`/field-mappings` | 产品、标准字段、字段映射。删产品时一并删掉该产品的字段、映射、EAD 配置、缓释配置和专属规则。另有 `POST /products/batch-delete`、`POST /products/:code/fields/batch-delete`、`POST /field-mappings/batch-delete`，请求体和返回与上面的批量删除相同。 |
| GET | `/exposure-classes`、`/exposure-class` | 分类 JSON 页签、单份分类。`/exposure-class?name=` 读 `exposure_document` 里 `seq > 0` 的那一行；不带 name 时仍读 `id = 1` 的权重法分类。 |
| GET、POST、PUT、DELETE | `/weights`、`/weight-rules`、`/bank-grades`、`/mo-weights`、`/crm`、`/product-rules` | 权重表一次读出三张表。权重规则、第一档银行评级、澳门评级档、缓释规则、产品专属规则各自增删改。被银行评级档引用的权重规则不能删。另有 `POST /weight-rules/batch-delete`、`POST /bank-grades/batch-delete`、`POST /mo-weights/batch-delete`、`POST /crm/batch-delete`、`POST /product-rules/batch-delete`。 |
| POST | `/exposure-tree/copy`、`/exposure-tree/delete`、`/exposure-tree/propose`、`/exposure-tree/save` | 添加页签时复制通用。删除页签时按 name 删掉 `seq > 0` 的那一行，标签为「通用」的不删。对话先说明当前规则，确认后询问是否保存，保存才写入。没在对话里出现的权重不写入。 |
| GET、POST | `/exposure-tree/chat` | 按分类 name 读取或保存决策树对话。内容写在仓库根目录 `决策树对话.json`，不提交。 |
| GET、PUT | `/ead-config` | 表内外 EAD 计算配置。读写在 `ead_product_config`、`ead_product_rule` 两张表；保存前整份校验产品 code、公式语法、字段范围和适用条件，对不上就报错不写。 |
| GET、PUT | `/crm-config` | 信用风险缓释配置。读写在 `crm_product_config`、`crm_slot_column`、`crm_eligible_type` 三张表；保存前整份校验产品 code、笔数上限（1–6）、列名是否属于该产品的源表列、同属性内与同一笔内的列名冲突、字典编码是否重复，对不上就报错不写。三个属性（`crm_type`/`crm_value`/`crm_weight`）都是必选：第 1 笔必须填满，其余笔要么整笔留空、要么三个都填。 |
| POST | `/ead-formula/check` | 校验一条公式：语法，以及引用字段是否属于该产品的标准字段。公式编辑器实时调它。 |
| POST | `/ead-trial` | 按配置的公式试算一条规则。 | 
| GET、POST、PUT、DELETE | `/ccf` | 转换系数。另有 `POST /ccf/batch-delete`。 |
| GET、POST | `/batches`、`/batches/:id`、`/batches/:id/lines` | 计量批次、一次已保存的计量过程、逐笔明细。 |
| GET、POST | `/measure`、`/measure/runs`、`/measure/workbook`、`/measure/workbook.xlsx`、`/measure/apply`、`/measure/map`、`/measure/products`、`/measure/classify` | 模拟计量，或读取上传的 xlsx。`POST /measure/products` 把每一组产品代码和抽样交给模型，从已配置产品里选。`POST /measure/apply` 按向导里选定的产品、表头列和分类文档重算。`POST /measure/map` 先按产品标准字段对表头，对不上的再交给模型，并带上各列抽样值和 RWA 用途说明。`POST /measure/classify` 把上传的工作簿交给 `agent/subagents/weight`，按权重法风险暴露分类逐笔取暴露和权重。`POST /measure/runs` 把这次用的分类、EAD、缓释和 RWA 写入批次。带 `uploadId` 时写入的是刚上传的工作簿，带 `choiceId` 时写入的是刚重算的模拟结果。`GET /measure/workbook.xlsx?uploadId=` 下载已经写回风险权重、EAD、RWA 和计算过程的那份上传工作簿。 |
| GET | `/working-paper`、`/upload-samples`、`/audit.xlsx` | 信用风险底稿缓存、上传样例、审计工作簿。 |
| GET | `/assistant` | 规则助手历史。 |
| POST | `/agent/chat` | 原样转发到 Flask `8766`。这里不实现智能体。决策树对话的提议也转发到 Flask，写入留在 `/exposure-tree/save`。 |
| POST | `/rules/chat` | 原样转发到 Flask 的规则对话。 |

成功时响应体就是数据。4xx 失败时 `{ "error": "原因" }`。5xx 一律 `{ "error": "服务异常" }`，具体原因打在服务日志里。

## 表

`jurisdiction`、`customer`、`org_unit` 是客户和机构。`rule_version`、`clause_doc`、`clause_ref`、`rule_param` 是规则版本、条款和共用参数。`product_type`、`product_field`、`field_mapping` 是产品和字段。`exposure_document` 存权重法分类 JSON。`weight_rule`、`bank_grade_row`、`mo_weight_row` 是权重表。`ead_product_config`、`ead_product_rule` 是按产品的 EAD 配置和公式。`ccf_rule`、`crm_rule`、`product_exposure_rule` 是转换系数、缓释和产品规则。`crm_product_config`、`crm_slot_column`、`crm_eligible_type` 是按产品的缓释配置、逐笔列名绑定和合格缓释物字典。`measure_batch`、`measure_line` 是批次和逐笔结果。`measure_batch.rules_json` 记下当时用的分类文档、EAD 规则和缓释配置，`measure_line.detail` 记下这一笔的分类、EAD 步骤、缓释结论和 RWA。`assistant_turn` 是规则助手对话。

表内 / 表外 EAD 计算规则在 `ead_product_config`、`ead_product_rule`。一个产品只能选表内或表外。`tools/build-seed.mjs` 按产品公式生成这两张表的种子，公式先过 `lib/formula.cjs`。

缓释配置在 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`。`crm_slot_column` 的 `attr` 只有 `crm_type` / `crm_value` / `crm_weight` 三个值，`slot` 是第几笔。种子只灌 `crm_eligible_type` 的默认 5 类字典（每个产品一份），另外两张表不灌：没有行时按「无需配置、无绑定」返回，产品的默认状态就是无需配置。字典与「是否需要配置」无关，两种状态都照常保存 —— 标为无需配置只清列名绑定。

新表写进 `sql/001_schema.sql`，并在文件开头的 `DROP TABLE` 里按依赖顺序补上。种子数据需要跟着变时，改 `tools/build-seed.mjs` 再生成 `002_seed.sql`。

## 写接口时以哪个文件为准

列名只来自 `sql/001_schema.sql`。写 `SELECT` 之前打开这张表的 `CREATE TABLE`，没有的列不要出现。

响应键只在本路由的 `ctx.body` 里定义一次。对照 `GET /products`：库列 `rule_version` 写成 `ruleVersion`，`description` 写成 `desc`，`source_system` 写成 `system`。页面若要新键，先改这里的映射，不要在 Vue 里读一个还没返回的名字。

日期用文件顶部的 `date()`，JSON 列用 `json()`。参数用 `query(sql, [占位值])`。`query` 定义在 `src/db.js`，不要再创建连接池。

`/measure` 的笔数和金额由 `src/measure.js` 算出来。上传工作簿时，没有指定工作表就读入所有带金额列的明细表。`term-Loan`、`Mortgage`、`BILLS` 和名称里带「贷款」的表对应对公贷款或个人贷款，`Bonds` 和名称里带「债券」「债权」的表对应债券投资。分类文档按产品名称对应 `exposure_document` 里 `seq > 0` 的页签：产品名称包含页签名时用最长的那一页，对不上时用页签「通用」。分类前，表头 `Cust Type`、`INDUSTRY`、`RATING` 按权重计算里已有的对应写入交易对手和发行人评级。债券分类文档有 `industry`、`credit_quality_grade` 时，`INDUSTRY` 写入行业，`RATING GRADES` 写入信用质量等级。金额列 `Value Balance(MOP)`、`Equiv to MOP`、`O/S BAL_MOP` 写入余额。同一张表上没有的列留空，不拿另一张表的空表头挡住后面的列。不要在路由或页面里写死另一套合计。`/working-paper` 只读 `agent/subagents/weight/paper/底稿模型计算.json`，不要在请求里重算。

## 加一个接口

1. 在 `src/index.js` 增加路由。查询用 `query`，参数用占位符，不要拼接 SQL。
2. 返回给页面的字段用驼峰。库里的下划线只留在 SQL 里。
3. 日期用已有的 `date()`，JSON 列用已有的 `json()`。
4. 前端到 `client/src/api/` 加函数，路径不要再写一遍 `/api`，`request` 已经带了前缀。函数路径必须和刚加的路由一致。
5. 计算权重、跑工作簿、派子智能体，不要写进 Koa。那是 `agent/` 的事。
