# 后端

Koa 2，前缀 `/api`，默认 `http://127.0.0.1:8780`。数据在 MySQL，连接来自本目录 `.env`。页面要的列表和保存走这里。风险暴露权重的计算不在这里，在 `agent/`。

生成接口前先看根目录 `README.md`。新路由加在 `src/index.js`，查询可以留在该文件；一段逻辑超过一个路由时，拆到 `src/` 下的新文件，由 `index.js` 引入。

## 目录

| 路径 | 作用 |
| --- | --- |
| `src/index.js` | 全部 HTTP 路由，以及行数据到 JSON 的形状。 |
| `src/ruleWrite.js` | 规则配置的新增、修改、删除和批量删除：机构、版本、条款、参数、产品、字段、映射、权重、转换系数、缓释规则、专属规则。 |
| `src/exposureDocs.js` | 从 `exposure_document` 读页签分类（`seq > 0`）：通用、贷款、债券，以及后来新增的页签。每一份跟 `rule_version` 上的版本编号走。确认写入也写回这张表。页签可以删除，标签为「通用」的那一页不能删。某个版本还没有分类时，`POST /exposure-tree/provision` 从同一地区已有的分类复制一份。每个产品的决策树对话仍在仓库根目录 `决策树对话.json`。 |
| `src/db.js` | 读取 `.env`，导出 `query(sql, params)`。 |
| `src/measure.js` | `GET /measure`、`POST /measure/workbook`、`GET /measure/workbook.xlsx`、`POST /measure/runs` 和审计底稿。模拟债项在 `data/`，上传的 xlsx 用本机 Python 的 openpyxl 读。计量在 `lib/`。分类规则：有 V3.5 产品注册的版本走 `src/measureV35.js` 和 `rule_document`，历史版本回退 `exposure_document`；EAD 读 `ead_product_config`、`ead_product_rule`，缓释读 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`。跑完写入 `measure_batch.rules_json` 和 `measure_line.detail`。上传的工作簿会在原表每一行后面写上风险权重、EAD、RWA 和计算过程，`GET /measure/workbook.xlsx?uploadId=` 下载这份写回的文件。 |
| `src/tasks.js` | 信用风险 RWA 任务工作台的主任务和子任务。主任务等于一个季度的计量作业，创建时固定监管版本和机构；子任务继承主任务的版本和机构，`module` 区分资本充足率和流动性，资本充足率子任务由计量向导执行完成时把 `measure_batch` 批次归档回 `rwa_task_sub`。创建前检查该版本的产品注册、分类、权重和字段映射是否完整；`POST /rwa-tasks` 可带 `subtasks` 一次创建资本充足率和流动性子任务。只读写库表，不计算权重。 |
| `src/paper.js` | `GET /working-paper` 和上传样例。底稿读 `agent/steps/weight/paper/底稿模型计算.json`，样例读 `data/data.js`。 |
| `src/ruleDocs.js` | 敞口划分和产品标准字段配置的规则文档：分类规则、风险权重、产品注册、8 套字段映射的读写、校验和从 `docs/信用风险规则/` 导入。导入时读取 `product_groups.v1.0.0.json`，把业务产品组写入产品注册的 `product_profiles`，并把组代码追加到 `product_codes`。文档按监管版本存在 `rule_document`，不参与计算。 |
| `src/refData.js` | 规则文档引用的参数表和监管名单：`rule_parameter_table`、`rule_list` 的读写，以及导入时的覆盖写入。 |
| `lib/ruleset-validator.cjs` | V3.5 规则集、产品注册（v1.1.0）和字段映射（v1.1.0）的校验，关键字与 `docs/信用风险规则/schema/` 一致。页面保存前和校验按钮都用这一份。 |
| `src/measureV35.js` | 计量向导的 V3.5 链路：按当前监管版本或传入的已发布快照组装产品族、标准字段和字段映射，执行分类、风险权重、EAD、缓释和 RWA。`buildV35Pack`、`classifyV35Pack`、`weightV35Pack`、`finalizeV35Pack` 都接受可选 `config`，正式任务全程使用任务绑定的快照。 |
| `agent/steps/weight/v35.py` | V3.5 暴露分类 / 风险权重执行器：条件、字段派生、参数表/名单查询、`parameter_lookup`、`adjustments`、`children/otherwise`，并返回命中路径和求值留痕。 |
| `src/productStandard.js` | EAD 和信用风险缓释共用的产品清单：按监管版本读 `rule_document` 的 `product_registry`，产品为产品族，标准字段为该产品注册的 `standard_fields`；该版本还没有产品注册时回退到 `product_type` / `product_field`。 |
| `src/ruleGovernance.js` | 版本治理和计量配置加载：版本概览、完整性校验、提交审核、发布、复制、版本差异、配置快照、快照比较/回滚、`RwaConfigLoader`、条款影响分析和修订记录。正式计量只读已发布快照。 |
| `src/configAudit.js` | `config_revision` 修订/审计写入、读取和乐观锁 `assertRevision`，以及已发布版本只读校验 `assertVersionWritable`。 |
| `src/ruleVersion.js` | 监管版本上下文：`version` 字符串或 `rule_version.id` 统一解析成 `rule_version_id`，并提供当前辖区默认版本。EAD、CRM、参数表、名单和规则文档都通过它确定版本归属。 |
| `src/eadConfig.js` | `GET`/`PUT /ead-config` 和 `POST /ead-formula/check`。读写 `ead_product_config`、`ead_product_rule`，按 `rule_version_id + product_code` 隔离。保存只处理当前版本、当前请求里的产品，按产品 Upsert，不再删除整表。产品清单和公式可用字段来自 `src/productStandard.js`，公式校验用 `lib/formula.cjs`。 |
| `src/crmConfig.js` | `GET`/`PUT /crm-config`。读写 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`，按 `rule_version_id + product_code` 隔离并逐产品 Upsert。`crm_slot_column.target_fact_code` 是计算引擎读取的标准事实编码，缺省等于 `crm_type` / `crm_value` / `crm_weight`。产品清单和标准字段来自 `src/productStandard.js`，可绑定的源表列取自该产品标准字段的 `source_field`。 |
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
| POST、GET | `/auth/login`、`/auth/logout`、`/auth/session` | 登录与退出。登录校验账号、角色状态和 SHA-256 密码，成功时返回账号、角色和可访问菜单，并写 `login_log`。退出也写一条登录日志。`GET /auth/session?username=` 给已登录页面刷新角色和菜单；账号或角色停用返回 403。密码不存明文、不回传。 |
| GET | `/menus` | 系统管理的菜单分组，供权限页渲染勾选项。 |
| GET、POST、PUT | `/users`、`/users/:id` | 账号列表、新增、编辑。`POST /users/:id/toggle` 启停账号，`POST /users/:id/reset-password` 把密码重置为 `ecl2026`。用户名创建后不改，授权的机构写在 `orgs_json`。 |
| GET、POST、PUT | `/roles`、`/roles/:id` | 角色列表、新增、编辑。`PUT /roles/:id/menus` 保存这一角色的菜单权限，`POST /roles/:id/toggle` 启停角色；超级管理员角色不可停用，菜单权限不可改。 |
| GET | `/login-logs`、`/operation-logs` | 登录日志和操作日志，按时间倒序，默认最近 200 条。用户、角色、大模型配置和权限的写入都会记一条操作日志。 |
| GET、POST、PUT | `/llm-configs`、`/llm-configs/:id` | 当前账号的大模型配置，按 `owner` 隔离。列表只返回密钥掩码，更新时 `apiKey` 留空表示不改。`POST /llm-configs/:id/test` 用这份配置向模型发一次最小请求并记录测试时间，`/default` 设为账号默认，`/toggle` 启停。 |
| GET、POST | `/token-logs` | Token 调用明细与统计。筛选参数 `from`、`to`、`user`、`model`，返回 `rows`、`summary`、`users`、`models`。`POST` 预留给智能体写入调用记录。 |
| GET | `/bootstrap` | 客户、机构、地区、版本。给前端 Vuex。 |
| GET | `/dashboard` | 总览数字。批次清单不截断，页面再按顶栏版本筛。 |
| GET、POST、PUT、DELETE | `/orgs`、`/rule-versions`、`/clauses` | 机构、规则版本、条款。机构名单同时给顶栏和版本的适用机构。改名称时，同一地区里规则版本和计量批次上的同名适用机构一起改。被规则版本或计量批次引用的机构不能删，也不能改地区。条款关键字匹配条款编号、标题、制度和制度版本。写入在 `src/ruleWrite.js`。编号创建后不改。规则版本的规则类型、适用机构、规则文件、发布时间、维护人、变更说明可以留空；地区和规则名称必填。版本被产品、EAD、专属规则或计量批次引用时不能删。条款被专属规则或 EAD 规则引用时不能删。另有 `POST /orgs/batch-delete`、`POST /rule-versions/batch-delete`、`POST /clauses/batch-delete`，请求体 `{ "ids": [] }`，返回 `{ deleted, blocked }`。被引用的留在 `blocked`。 |
| GET、POST、PUT、DELETE | `/products`、`/products/:code/fields`、`/field-mappings` | 产品、标准字段、字段映射。删产品时一并删掉该产品的字段、映射、EAD 配置、缓释配置和专属规则。另有 `POST /products/batch-delete`、`POST /products/:code/fields/batch-delete`、`POST /field-mappings/batch-delete`，请求体和返回与上面的批量删除相同。 |
| GET | `/exposure-classes`、`/exposure-class` | 分类 JSON 页签、单份分类。带 `version` 时只读该版本编号下 `seq > 0` 的行。`/exposure-class?name=` 读其中一行；不带 name 时仍读 `id = 1` 的权重法分类。 |
| GET | `/weights`、`/weight-rules`、`/bank-grades`、`/mo-weights`、`/crm`、`/product-rules` | 权重表一次读出三张表。权重规则、第一档银行评级、澳门评级档、缓释规则、产品专属规则各自增删改。被银行评级档引用的权重规则不能删。另有 `POST /weight-rules/batch-delete`、`POST /bank-grades/batch-delete`、`POST /mo-weights/batch-delete`、`POST /crm/batch-delete`、`POST /product-rules/batch-delete`。 |
| GET、POST、PUT、DELETE | `/rule-documents`、`/rule-documents/:id` | 敞口划分和产品标准字段的规则文档。列表按 `jurisdiction`、`version`（监管版本编号）和 `kind` 筛选；`kind` 是 `exposure_classification`、`risk_weight`、`product_registry`、`data_mapping` 之一。`GET /rule-documents/:id` 返回 `body` 整份 JSON。`POST /rule-documents/:id/validate` 校验已保存文档，`POST /rule-documents/validate` 校验还没保存的 `{ kind, body, jurisdiction, ruleVersion }`。`POST /rule-documents/import` 按 `{ jurisdiction, version }` 从 `docs/信用风险规则/` 导入香港 STC 的两份规则集、8 套映射、产品注册、参数表和名单，同名文档覆盖。 |
| GET、PUT | `/parameter-tables`、`/parameter-tables/:id` | 规则集引用的监管参数表。列表带 `jurisdiction`、`version`，按当前版本取表，未版本化的旧行作为兼容回退。返回 `tableId`、`version`、`rowCount`；单张返回 `columns` 和 `rows`（二维数组）。保存时列数和每行列数必须一致。 |
| GET、PUT | `/reference-lists`、`/reference-lists/:id` | 规则集引用的监管名单。列表同样带 `jurisdiction`、`version` 并按版本取值。结构与参数表相同，另有 `listId`、`listType`。 |
| POST | `/exposure-tree/copy`、`/exposure-tree/delete`、`/exposure-tree/propose`、`/exposure-tree/save`、`/exposure-tree/provision` | 添加页签时复制当前版本的通用。删除页签时按 name 和版本删掉 `seq > 0` 的那一行，标签为「通用」的不删。`provision` 的请求体是 `{ "version": "版本编号" }`，这个版本还没有分类时，从同一地区已有分类复制页签。对话先判断修改或新增。修改先说明当前规则。新增把通用分类和 `clause_doc` 的条款一并交给助手，按条款从通用分类扩展。用户说全部或按条款库时，先出一版草稿，再由用户调整。确认后询问是否保存，保存才写入。改已有叶子时，权重必须出现在对话里。新增叶子的权重还要出现在监管条款里，或与通用分类里同名节点的权重相同。 |
| GET、POST | `/exposure-tree/chat` | 按分类 name 读取或保存决策树对话。内容写在仓库根目录 `决策树对话.json`，不提交。 |
| GET、PUT | `/ead-config` | 表内外 EAD 计算配置。`GET` 带 `?version=&jurisdiction=`，`PUT` 请求体带 `version` / `jurisdiction`，按 `rule_version_id + product_code` 读写 `ead_product_config`、`ead_product_rule`。保存前校验产品 code、公式语法、字段范围和适用条件，对不上就报错不写；只 Upsert 本次提交的产品，不影响其它版本和其它产品。 |
| GET、PUT | `/crm-config` | 信用风险缓释配置。同样按 `version` / `jurisdiction` 读写 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`，逐产品 Upsert。保存前校验产品 code、笔数上限（1–6）、列名是否属于该产品的源表列、同属性内与同一笔内的列名冲突、字典编码是否重复，对不上就报错不写。三个属性（`crm_type`/`crm_value`/`crm_weight`）都是必选：第 1 笔必须填满，其余笔要么整笔留空、要么三个都填。`target_fact_code` 缺省等于属性名。 |
| POST | `/ead-formula/check` | 校验一条公式：语法，以及引用字段是否属于该产品的标准字段。公式编辑器实时调它。 |
| POST | `/ead-trial` | 按配置的公式试算一条规则。 | 
| GET、POST、PUT、DELETE | `/ccf` | 转换系数。另有 `POST /ccf/batch-delete`。 |
| GET、POST | `/batches`、`/batches/:id`、`/batches/:id/lines` | 计量批次、一次已保存的计量过程、逐笔明细。批次名称是一次执行的主键，同名不能再写入。`POST /measure/runs` 也按这个名称落库。 |
| GET、POST、PUT、DELETE | `/rwa-tasks`、`/rwa-tasks/:id`、`/rwa-tasks/readiness`、`/rwa-tasks/:id/subs`、`/rwa-tasks/:id/subs/:subId`、`/rwa-tasks/:id/subs/:subId/hqla/open` | 信用风险 RWA 任务工作台。`POST /rwa-tasks/:id/subs/:subId/hqla/open` 为流动性子任务幂等创建或打开唯一 LCR 任务：继承主任务版本、机构、地区和基准日，生成配置快照 `hqla_snapshot`，回写 `rwa_task_sub.hqla_task_id`。`GET /rwa-tasks/readiness?version=&jurisdiction=` 检查产品注册、分类、权重和字段映射是否完整，缺失时创建被拒。创建主任务还要求该版本已有已发布配置快照，任务会绑定最新快照；没有发布快照时返回 409。`POST /rwa-tasks` 的 `subtasks` 数组可一次创建初始子任务；主任务创建时固定 `jurisdiction`、`version`（规则版本编号）和 `institution`，之后只能改名称和基准日。子任务记名称和 `module`（`capital` 或 `liquidity`），资本充足率子任务由计量向导触发，流动性子任务关联 LCR 任务；监管版本和机构继承主任务。`POST /rwa-tasks/:id/subs/:subId/archive` 的请求体是 `{ "batchId": "批次编号" }`，归档前校验批次的版本、地区和机构与主任务一致。 |
| GET、POST | `/measure`、`/measure/runs`、`/measure/workbook`、`/measure/workbook.xlsx`、`/measure/apply`、`/measure/map`、`/measure/products`、`/measure/classify`、`/measure/classify/trace/:uploadId/:file` | 模拟计量，或读取上传的 xlsx。`POST /measure/products` 把每一组产品代码和抽样交给模型，从已配置产品里选。每组按 uploadId 做种子随机抽 5–10 笔（默认 8），每笔带全部非空字段；同一份上传重复执行抽到同一批样例。`POST /measure/apply` 按向导里选定的产品、表头列和分类文档重算。`POST /measure/map` 先按产品标准字段对表头，对不上的再交给模型，并带上各列抽样值和 RWA 用途说明。`POST /measure/classify` 在 V3.5 版本下按产品注册的候选暴露类型执行 `rule_document` 的 `exposure_classification`，只返回暴露类别、命中路径和条件求值留痕；没有产品注册的历史版本仍从 `exposure_document` 匹配旧文档，由 `agent/steps/weight/classify.py` 解析。`POST /measure/weight` 对分类结果执行同一版本的 `risk_weight` 规则。`GET /measure/classify/trace/:uploadId/:file` 读取历史链路的 Markdown 留痕。`POST /measure/runs` 把这次用的分类、EAD、缓释和 RWA 写入批次，并写入 `snapshot_id`、`engine_version`；没有任务快照时使用该版本最新已发布快照，仍未发布则返回 409。计量向导的 `snapshotId` 会贯穿上传、产品识别、字段映射、分类、权重和正式批次。带 `uploadId` 时写入的是刚上传的工作簿，带 `choiceId` 时写入的是刚重算的模拟结果。`GET /measure/workbook.xlsx?uploadId=` 下载已经写回风险权重、EAD、RWA 和计算过程的那份上传工作簿。 |
| GET、POST、PUT、DELETE | `/liquidity/versions`、`/liquidity/meta`、`/liquidity/products`、`/liquidity/products/:code`、`/liquidity/products/:code/copy`、`/liquidity/products/:code/groups`、`/liquidity/products/:code/groups/validate`、`/liquidity/products/:code/field-groups`、`/liquidity/products/:code/rule-scopes`、`/liquidity/dictionaries`、`/liquidity/dictionaries/:dictCode/items`、`/liquidity/rules`、`/liquidity/params` | 流动性产品管理。产品、标准字段、字段分组、产品组、字典、规则包关联、参数表、参数和名单都按 `jurisdiction + rule_version` 读取。产品详情返回产品组、识别条件、字段分组、字段属性、字典、规则包、规则关联和完整性。`POST /liquidity/products/:code/copy` 自动生成新编码，复制标准字段、产品组、字段分组和规则关联；副本默认停用。产品级和产品组级规则关联互斥；删除产品、产品组、字段、分组、字典和码值前检查引用。`GET /liquidity/meta` 返回当前版本的 LCR 规则集快照、规则包和产品字段，供 HQLA 任务向导使用。 |
| GET、POST、PUT、DELETE | `/hqla/tasks`、`/hqla/tasks/:id`、`/hqla/tasks/:id/snapshot`、`/hqla/tasks/:id/datasets`、`/hqla/tasks/:id/datasets/:datasetId`、`/hqla/tasks/:id/products/recognize`、`/hqla/tasks/:id/recognitions`、`/hqla/tasks/:id/recognitions/confirm`、`/hqla/tasks/:id/fields/suggest`、`/hqla/tasks/:id/fields`、`/hqla/tasks/:id/fields/confirm`、`/hqla/tasks/:id/preflight`、`/hqla/tasks/:id/quality/run`、`/hqla/tasks/:id/quality/runs`、`/hqla/tasks/:id/quality/issues`、`/hqla/tasks/:id/runs`、`/hqla/tasks/:id/runs/:runId`、`/hqla/tasks/:id/runs/:runId/results`、`/hqla/tasks/:id/runs/:runId/exceptions`、`/hqla/tasks/:id/runs/:runId/export.xlsx`、`/hqla/tasks/:id/review`、`/hqla/tasks/:id/identify`、`/hqla/tasks/:id/auto-map`、`/hqla/tasks/:id/quality`、`/hqla/tasks/:id/lcr-compute`、`/hqla/inspect-workbook`、`/hqla/parse-workbook` | LCR 计量任务。任务通过 `rwa_task_id` / `rwa_task_sub_id` 关联主任务和流动性子任务，保留配置快照、输入版本、当前计算批次、计算状态和复核状态。`hqla_task_dataset` 按 Sheet 存表头、标准化行、抽样、数据特征、产品识别、字段 Mapping 和质量结论；`hqla_record` 存逐笔原始记录和 record_id。`/products/recognize` 调用 Flask 的 `liquidity-product-identifier` Skill 生成识别策略，再由 Koa 批量执行并写入 `hqla_product_recognition`；`/recognitions/confirm` 保存人工确认。`/fields/suggest` 调用 `liquidity-standard-field-matcher` 生成建议，`/fields/confirm` 保存按 `dataset + product + source_column` 的人工对应。`/quality/run` 执行四层检查并写 `hqla_quality_issue`；`/preflight` 检查输入版本、产品确认、必需字段、质量结论和快照完整性。`POST /runs` 只读快照和逐笔对应组装计算输入，写 `hqla_task_run`、`hqla_result_detail`、`hqla_result_summary` 和 `hqla_calculation_exception`；允许 `allowPartial` 排除 BLOCK 记录并披露。`/review` 写 `hqla_review`、归档任务并回写流动性子任务；`/export.xlsx` 按计算批次生成完整底稿，包含封面、监管指标、产品维度、逐笔结果、计算异常、质量异常、质量结论、数据集、配置快照和适用产品。`inspect-workbook` / `parse-workbook` 在 Flask 里解析 Excel；`lcr-compute` 转发 Flask 的 `agent/core/hqla/lcr.py` 做 HQLA / 现金流入流出 / LCR 汇总。 |
| GET | `/working-paper`、`/upload-samples`、`/audit.xlsx` | 信用风险底稿缓存、上传样例、审计工作簿。 |
| GET | `/assistant` | 规则助手历史。 |
| POST | `/agent/chat` | 原样转发到 Flask `8766`。这里不实现智能体。决策树对话的提议也转发到 Flask，写入留在 `/exposure-tree/save`。 |
| POST | `/rules/chat` | 原样转发到 Flask 的规则对话。 |

成功时响应体就是数据。4xx 失败时 `{ "error": "原因" }`。5xx 一律 `{ "error": "服务异常" }`，具体原因打在服务日志里。

## 表

`jurisdiction`、`customer`、`org_unit` 是客户和机构。`rule_version`、`clause_doc`、`clause_ref` 是规则版本和条款。`product_type`、`product_field`、`field_mapping` 是产品和字段。`exposure_document` 存权重法分类 JSON，`rule_version` 是规则版本编号，和 `rule_version.version` 对照；`seq = 0` 的那一行不挂版本。

`rule_document` 存 V3.5 规则配置文档，一行一份：`kind` 区分分类规则、风险权重、产品注册和字段映射，`rule_version` 对到监管版本，`body` 是整份 JSON。现有库先执行 `node tools/migrate-car-workbench.mjs`：补 `rule_version_id`、`framework`、`config_status`、修订号和哈希，回填 EAD/CRM/参数表/名单/条款/批次/任务的版本归属，新增 `config_revision`、`rule_config_snapshot`、`rule_config_snapshot_item`、`rule_clause_relation`。EAD、CRM、参数表和名单都按 `rule_version_id` 隔离读写；找不到版本的旧行作为兼容回退。旧配置表（`product_type`、`product_field`、`field_mapping`、`exposure_document`、`weight_rule`、`ccf_rule`、`crm_rule`、`product_exposure_rule`）保留只读，写接口返回 409。`liquidity_config_meta`、`liquidity_product`、`liquidity_product_field`、`liquidity_rule`、`liquidity_param_table`、`liquidity_param`、`liquidity_list` 是流动性域的产品、字段、规则、参数表和名单，全部按 `(jurisdiction, rule_version)` 版本化；`liquidity_product_group` 存产品组和识别条件，`liquidity_field_group` 存字段分组，`liquidity_dictionary` / `liquidity_dictionary_item` 存公共和产品专属字典及码值，`liquidity_rule_scope` 存产品或产品组与规则包的关联（`group_code` 为空表示产品级）。`liquidity_product.group_mode` 区分是否启用产品组，`liquidity_product_field.attributes_json` 存业务类型、单位、精度等扩展属性。现有库用 `node tools/migrate-liquidity-workbench.mjs` 补表补列并回填；新版本用 `node tools/import-liquidity.mjs --jurisdiction HK --version HK-SA-2026.1` 从 `server/data/liquidity.v1.0.0.json` 导入。`hqla_task` 是 LCR 计量任务，通过 `rwa_task_id` / `rwa_task_sub_id` 关联主任务和流动性子任务，并保存配置快照、输入版本、当前计算批次、计算状态和复核状态；`hqla_task_dataset` 存每个 Sheet 的表头、标准化行、抽样、数据特征、产品识别、字段 Mapping 和质量结论；`hqla_record` 存逐笔原始记录和稳定 record_id。`hqla_snapshot` 存冻结的监管配置，`hqla_file` 存原始文件，`hqla_product_rule` / `hqla_product_recognition` 存产品识别策略和逐笔建议/确认，`hqla_field_suggestion` / `hqla_field_mapping` 存字段建议和人工确认，`hqla_quality_run` / `hqla_quality_issue` 存质量批次和逐笔问题，`hqla_task_run` / `hqla_result_detail` / `hqla_result_summary` / `hqla_calculation_exception` 存计算批次、逐笔结果、汇总和异常，`hqla_review` / `hqla_audit_log` 存复核和操作留痕。现有库用 `node tools/migrate-lcr-workbench.mjs` 补表补列。`rule_parameter_table` 和 `rule_list` 分别存规则集引用的参数表和监管名单，`columns_json` 是表头顺序，`rows_json` 是按表头排列的二维数组；按 `(rule_version_id, table_id, table_version)` 和 `(rule_version_id, list_id, list_version)` 覆盖更新。这三张表只服务配置页面，计算侧不从它们读权重。`weight_rule`、`bank_grade_row`、`mo_weight_row` 是权重表。`ead_product_config`、`ead_product_rule` 是按版本、按产品的 EAD 配置和公式，`rule_version_id + product_code` 唯一；产品清单优先来自 `rule_document` 的产品注册。`ccf_rule`、`crm_rule`、`product_exposure_rule` 是旧转换系数、缓释和产品规则，只读保留。`crm_product_config`、`crm_slot_column`、`crm_eligible_type` 是按版本、按产品的缓释配置、逐笔列名绑定和合格缓释物字典。`rwa_task`、`rwa_task_sub` 是任务工作台的主任务和子任务，子任务的 `module` 区分资本充足率和流动性，`batch_id` 指向资本充足率计量批次；`rwa_task.snapshot_id` 绑定创建时的已发布配置快照，归档批次时要求批次快照与任务快照一致。`measure_batch`、`measure_line` 是批次和逐笔结果。`measure_batch.rules_json` 记下当时用的分类文档、EAD 规则和缓释配置，`measure_batch.rule_version_id` 记版本归属，`measure_line.detail` 记下这一笔的分类、EAD 步骤、缓释结论和 RWA。`assistant_turn` 是规则助手对话。`app_user`、`app_role` 是账号和角色，角色菜单写在 `app_role.menus_json`，账号授权机构写在 `app_user.orgs_json`；`login_log`、`operation_log` 是登录和关键操作留痕；`llm_config` 按 `owner` 存每个账号的模型配置，`token_log` 是模型调用明细。

表内 / 表外 EAD 计算规则在 `ead_product_config`、`ead_product_rule`。产品清单和标准字段来自产品注册（`rule_document.kind = 'product_registry'`），没有产品注册的历史版本回退到 `product_type` / `product_field`。一个产品只能选表内或表外。`tools/build-seed.mjs` 按产品公式生成这两张表的种子，公式先过 `lib/formula.cjs`。

缓释配置在 `crm_product_config`、`crm_slot_column`、`crm_eligible_type`；产品清单与可绑定源表列同样来自产品注册。`crm_slot_column` 的 `attr` 只有 `crm_type` / `crm_value` / `crm_weight` 三个值，`slot` 是第几笔。种子只灌 `crm_eligible_type` 的默认 5 类字典（每个产品一份），另外两张表不灌：没有行时按「无需配置、无绑定」返回，产品的默认状态就是无需配置。字典与「是否需要配置」无关，两种状态都照常保存 —— 标为无需配置只清列名绑定。

新表写进 `sql/001_schema.sql`，并在文件开头的 `DROP TABLE` 里按依赖顺序补上。种子数据需要跟着变时，改 `tools/build-seed.mjs` 再生成 `002_seed.sql`。

## 写接口时以哪个文件为准

列名只来自 `sql/001_schema.sql`。写 `SELECT` 之前打开这张表的 `CREATE TABLE`，没有的列不要出现。

响应键只在本路由的 `ctx.body` 里定义一次。对照 `GET /products`：库列 `rule_version` 写成 `ruleVersion`，`description` 写成 `desc`，`source_system` 写成 `system`。页面若要新键，先改这里的映射，不要在 Vue 里读一个还没返回的名字。

日期用文件顶部的 `date()`，JSON 列用 `json()`。参数用 `query(sql, [占位值])`。`query` 定义在 `src/db.js`，不要再创建连接池。

`/measure` 的笔数和金额由 `src/measure.js` 算出来。上传工作簿时，没有指定工作表就读入所有带金额列的明细表。`term-Loan`、`Mortgage`、`BILLS` 和名称里带「贷款」的表对应对公贷款或个人贷款，`Bonds` 和名称里带「债券」「债权」的表对应债券投资。分类文档按产品名称对应 `exposure_document` 里 `seq > 0` 的页签：产品名称包含页签名时用最长的那一页，对不上时用页签「通用」。分类前，表头 `Cust Type`、`INDUSTRY`、`RATING` 按权重计算里已有的对应写入交易对手和发行人评级。债券分类文档有 `industry`、`credit_quality_grade` 时，`INDUSTRY` 写入行业，`RATING GRADES` 写入信用质量等级。金额列 `Value Balance(MOP)`、`Equiv to MOP`、`O/S BAL_MOP` 写入余额。同一张表上没有的列留空，不拿另一张表的空表头挡住后面的列。不要在路由或页面里写死另一套合计。`/working-paper` 只读 `agent/steps/weight/paper/底稿模型计算.json`，不要在请求里重算。

## 加一个接口

1. 在 `src/index.js` 增加路由。查询用 `query`，参数用占位符，不要拼接 SQL。
2. 返回给页面的字段用驼峰。库里的下划线只留在 SQL 里。
3. 日期用已有的 `date()`，JSON 列用已有的 `json()`。
4. 前端到 `client/src/api/` 加函数，路径不要再写一遍 `/api`，`request` 已经带了前缀。函数路径必须和刚加的路由一致。
5. 计算权重、跑工作簿、派子智能体，不要写进 Koa。那是 `agent/` 的事。
