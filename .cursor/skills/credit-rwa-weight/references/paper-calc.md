# paper_calc 怎么算

文件：`agent/subagents/weight/calc/paper_calc.py`。分类树来自同目录 `exposure_class.prototype_flow()`，见 `references/exposure-class.md`。留痕见 `references/calc-trace.md`。三次模型调用的提示词见 `references/prompts.md`。

## 入口

`python -m agent.subagents.weight.calc.paper_calc 工作簿.xlsx [结果.xlsx]` 调用 `run_workbook`。它不读缓存。

1. `compute_working_paper` 算出全部行。
2. `save_trace_file` 写出仓库根目录 `output/traces/工作簿名-计算留痕.json` 和同名 `.md`。
3. `write_annotated_source` 把源工作簿复制一份，写上分类结果。没有逐笔行或源文件不存在时，改走 `write_result_workbook`（汇总、分类结果、分表、字段对应）。

`load_or_compute` 是另一条路。底稿不比 `agent/subagents/weight/knowledge/底稿模型计算.json` 新，且缓存里有同一 `file`、`sheets`、`process_rows`、`sheet_plan` 时直接读缓存；否则重算并覆盖缓存。命令行不走它。不要手改这份缓存。底稿页用的缓存在 `agent/subagents/weight/paper/底稿模型计算.json`。

流水线步骤 `agent/subagents/weight/program.py` 的 `run` 只把 `context["source"]` 交给 `run_workbook`，再把 `annotated`、`trace_file`、`ead_yi`、`rwa_yi` 放回 context。

## 选表

`_resolve_sheet_plan` 按这个顺序：

1. 表头前 8 行里出现分类字段 `name`，或「中文名（字段名）」这种表头，并且该表有金额列、不是纯外汇名义本金。若这类表的张数等于全部「有金额列且不是名义本金」的表，直接用它们，不调用模型。说明是「这些表的表头写了分类字段，直接按列计算。」
2. 否则调用 `plan_workbook_sheets`。模型把某张表标成 skip 时，只要该表有金额列且不是外汇名义本金，仍逐笔计算。模型失败或一个明细表都没留下时，先用这些金额列；再退回文件里的 `SHEETS`：term-Loan、Mortgage、BILLS、`212 222 存放同业`、Bonds、OD、額度詳情表、信用卡未使用額度表、TS-D-005。工作簿里没有的表名跳过。金额列和已知表名都对不上，才报错「没有认出逐笔明细」。

读完选定的表后，`_supplement_sheets` 再从 `FS-ASSETS` 合成三张没有逐笔明细的表：库存现金（`現金`）、存放中央银行（`AMCM`）、其他资产（不动产、设备、递延费用、开办费用、未完成不动产）。表上没有对应行就不生成。

`_paper_context` 另读三张辅助表，不把它们当逐笔明细：

- `本地中小企`：第 4 列是 Y 的客户号，记入中小企。
- `past due loan`：标签含「权重」的行，用第 4 列本金和第 5 列 ECL 算出一个全表减值比例。
- `同業rating`：按客户名保留标普、穆迪、惠誉各自的评级。只有一个评级时直接写入。有多个时先不写入，等 `rules` 里的 `multiple_assessments` 按权重取值。

## 字段怎么绑

每张表先 `_strong_bind`。对上的列直接用，对不上的不填。账面余额只认这些表头：Value Balance(MOP)、O/S BAL_MOP、Equiv to MOP、信貸敞口_MOP、剩余可使用额度（澳门元）。表被标成 `notional` 时不绑敞口。

整表常量：

- 普通明细：`instrument_type=claim`，`treat_as_equity=no`，`is_subordinated=no`。
- term-Loan、Mortgage、BILLS、OD、額度詳情表、信用卡未使用額度表：`fi_bank_applicable=not_applicable`，`is_credit_card=no`。
- 表名含「存放」：`counterparty_type=commercial_bank`，`fi_bank_applicable=applicable`，`is_credit_card=no`。
- 表名含「信用卡」：`is_credit_card=yes`，`counterparty_type=individual`，`fi_bank_applicable=not_applicable`。
- 「现金」：`instrument_type=cash`。「其他资产」：`other_asset`。「存放中央银行」：`foreign_central_bank`，`issuer_rating=unrated`。

有起息日和到期日时，`original_maturity_months` 记成计算字段，不拿到期日当期限。否则对 Original Period、BY PERIOD。天数在后面除以 30 变成月。表头本身就是字段名时，`_bind_declared_columns` 按字段名绑列；`single_exposure` 若已经绑在账面余额上，不被声明列盖掉。

`_strong_bind` 没有账面余额、表又有行时，才调用 `suggest_complete_map`。

## 一行变成事实

`_facts_from_row` 按映射取单元格或整表常量，再用字段的 options 把原文收成 code。空单元格不写入，该条件以后不会命中。评级列有映射但单元格空时，写成 `unrated`。

之后程序还会改这行，不依赖模型：

- 逾期天数大于 90，或科目以 209 开头，或户名含逾期、OVERDUE：`is_defaulted=yes`。没有这行自己的减值比例时，用 `past due loan` 的全表比例。
- 户名或产品含 CREDIT CARD，或科目以 207 开头：`is_credit_card=yes`。交易对手还不是自然人或公司时写成 `individual`。
- 客户号在本地中小企名单，或「本地中小企」列是 Y：`enterprise_size=small`。还没有交易对手时写成 `corporate`。
- OD、額度詳情表还没有交易对手时：「濠人貸」为是则 `individual`，否则 `corporate`。
- 科目 212、222，或户名含 FOREIGN BANK、INTERBANK、NOSTRO、存放同业：`commercial_bank`，`fi_bank_applicable=applicable`。名称里有 CENTRAL BANK、AMCM、AUTORIDADE、央行的，改成 `foreign_central_bank`。
- 存放或商业银行还没有发行人评级时，用 `同業rating` 按客户名补。单元格里已经有两家及以上评级时，记在 `_rating_choices`，不用同业表覆盖。
- 减值准备金额大于 1 时，除以这行账面余额，得到比例。
- 抵押描述像房产，且不是表头声明的 `property_uses` 列：`has_property_collateral=yes`，用途写入 `property_uses`。文字含出租、租金、收租、RENTAL、INVESTMENT 时 `cashflow_dependent=yes`，否则 no。
- 没有声明 `original_maturity_months` 列时，用到期日减起息日的天数除以 30。
- 有抵押品价值且没有声明 `ltv` 列时，`ltv` 等于账面余额除以抵押品价值。
- 主权按国别：中国写成 `cn_central_government`，其他国家写成 `foreign_sovereign`。

`_draft_rows` 保留 `_row_has_identity` 认得出客户、合同、科目或 ISIN 的行。金额就是这行的 `single_exposure`；单元格没有金额时按 0 计入，这一行仍做风险暴露分类。

全部表的草稿加总得到全行合计。`_roll_up_debtors` 再按客户把金额加总，写回每一行的 `single_exposure`，并标 `_debtor_rolled`。同一债务人的每一行都变成加总后的数。

然后按这个顺序处理特殊规则和未定权重：

1. `_apply_rating_choices_ready`。同一评级字段有两个及以上符号时，每个符号走一遍决策树。能得到数字权重的才参与。1 个用该权重。2 个且不同，用较高权重。3 个及以上且不同，用两个较低权重里较高的一个。相同则用该权重。选中的符号写回字段。规则缺失时，退回较低的评级符号。
2. `_fill_open_weights`。权重已经是数字的行不送模型。
3. `_apply_bank_link`。先按资本档次分类。同一客户名下，已归入商业银行且有外部评级的债权，把其中最高的权重写入未评级债权的 `bank_peer_weight`，已得权重写入 `derived_bank_weight`。之后再分类时，商业银行下的未评级节点按这些字段命中。没有参考权重时不写这两个字段。

`_calculate_sheet` 再走一次决策树。多家评级会在权重步骤后追加一条「多重评级取值」。同业未评级的最终权重来自商业银行下命中的那个节点。

## 分类、敞口、风险加权资产

每张表 `_calculate_sheet`：对草稿里的每一行 `_classify`。

- 命中路径的最后一档给出权重。`value` 直接用。`same_as: counterparty_ordinary_claim` 时，把这行改成普通债权再从最外层走一次，用那次的权重。`greater_of` 里带交易对手时，取固定地板和那次权重里较大的一个，地板默认 0.9。`greater_of` 里带字段名时，取固定数字和该字段中较大的一个。
- 权重是数字时，风险加权资产等于这行金额乘权重。不是数字的金额计入未定敞口，不乘一个替代权重。
- 按「表 + 细类」汇总桶。模型原因去重后拼进桶的 `model_reason`。

命令行的亿元是澳门元金额除以 1 亿：`_yi(金额 / 1000) = 金额 / 1e8`。留痕里的 `ead`、`rwa` 仍是源表金额。

结果字典的键：`file`、`as_of`（当前写死 `20260930`）、`unit`、`field_count`、`mapped_fields`、`ead_yi`、`rwa_yi`、`unpriced_yi`、`rwa_thousand`、`note`、`sheet_plan`、`model_note`、`lines`、`process_rows`、`coverage`、`sheets`。`sheets` 里拿掉了每张表的 `fields` 和 `process_rows`。

## 写回 Excel

`write_annotated_source`：

- 新工作簿第一张表「风险暴露分类」：源表、行号、客户、风险暴露类型、权重、判定说明。客户优先用源表 Customer Name、客户名称、客戶名。
- 能对上源表和行号的，在该表表头末尾加三列：风险暴露类型、权重、判定说明。已有这三列就覆盖。
- 对不上的行写到「计算补充」。
- 「计算留痕」表由 `write_trace_sheet` 覆盖重写。

敞口和风险加权资产不写入明细列。
