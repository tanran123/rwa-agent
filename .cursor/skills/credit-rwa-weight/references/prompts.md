# 通义千问提示词

调用在 `agent/subagents/weight/calc/model.py` 的 `_complete`。模型默认 `qwen-plus`，地址默认 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`，`temperature` 为 0。密钥读 `交付/exposure-weight-decision/.env` 的 `DASHSCOPE_API_KEY`，没有则读 `QWEN_API_KEY`。`QWEN_BASE_URL`、`QWEN_MODEL` 可以覆盖默认值。

返回正文用 `_extract_json` 取出一个 JSON 对象。改下面任一段时，同时改对应的 Python 函数和本文件。

## 1. 选哪些表逐笔算

函数：`paper_calc.py` 的 `_plan_system`。调用：`plan_workbook_sheets`。

用户消息是 `{"sheets":[{"sheet":"表名","rows":[{"row":行号,"cells":["单元格",...]}]}]}`。每张表最多看前 30 行、前 18 列，挑出至少 4 个非空单元格的行，最多 3 行，每行最多 8 个单元格、每个截到 28 字。

系统提示原文：

```text
用户上传了一本信用风险工作簿，用来计算 RWA。它不一定是某一家银行的固定底稿。请根据每张表的名称和前几行内容，判断哪些是要逐笔计算的明细，哪些是汇总、目录、评级对照或资产负债表。只输出一个 JSON 对象，不要解释。格式是 {"note":"一句：这本表里哪些是明细","sheets":[{"sheet":"表名","header_row":表头行号,"off":false,"notional":false,"skip":false,"reason":"一句"}]}。header_row 从 1 开始，必须是真正的列名行，不是标题、单位或空行。只选带逐笔金额的明细：贷款、债券、存放、票据、透支、承诺额度和信用卡未用额度。客户名单、中小企名单、抵押品清单、评级对照、限额、科目对照、监管汇总和资产负债表不要逐笔算，skip 为 true。只有外汇名义本金、没有信用等值金额的表，notional 为 true 且 skip 为 true。表外承诺、未使用额度 off 为 true。不要编造工作簿里没有的表名。
```

程序怎么用返回值：

- `sheet` 必须是工作簿里真实的表名，重复的丢掉。
- `skip` 或 `notional` 为 true 的表不逐笔算，原因记进说明。
- 模型给的 `header_row` 只用来检查那一行够不够宽。真正采用的表头行是程序自己用 `_amount_header_row` 找到的金额列表头。找不到金额列，或那一行是外汇名义本金，这张表丢掉。
- `off` 不采用模型的值。表名含「额度」「額度」「未使用」「承诺」「承諾」「表外」才标成表外。
- 模型没选、也没标 skip，但表上有金额列且不是外汇名义本金的，程序仍补进明细。表名是「现金」时，即使模型标了 skip，只要表头写了分类字段，仍可能被补上。

表头已经写了分类字段、并且这样的表和「有金额列的表」张数一样时，不调用这次模型。见 `references/paper-calc.md` 的选表。

## 2. 表头对到分类字段

函数：`model.py` 的 `_complete_system`。调用：`suggest_complete_map`，由 `paper_calc._map_sheet` 使用。

只在 `_strong_bind` 没有对上账面余额、并且这张表有数据行时才调用。已知底稿通常走固定列名，不会进这里。

用户消息：

```json
{
  "task": "这是一份信用风险明细，要计算 RWA。请把每一个字段都对应上。",
  "workbook": {"file": "工作簿名", "sheet": "表名", "rows": ["几行样例"], "note": "只附了几行样例，列和整表一致。"},
  "fields": [{"id": "字段名", "label": "中文", "hint": "含义", "options": ["中文=code"]}],
  "headers": [{"column": "A", "header": "表头"}]
}
```

系统提示原文：

```text
用户给出信用风险底稿的一张表，要计算 RWA（风险加权资产）。字段 id 来自权重法风险暴露分类 JSON，必须原样使用。每一个字段都要在 mapping 里出现一次，不能漏。只输出一个 JSON 对象。格式是 {"extract":"一句","mapping":{"字段id":{...}}}。对得上某一列时写 {"column":"列字母","reason":"为什么这列就是这个字段"}。整张表都是同一个取值时写 {"const":"选项code","reason":"为什么整表如此"}，const 必须是该字段 options 里的 code。底稿确实没有、也不能从这张表的产品性质判断时写 {"missing":true,"reason":"底稿没有"}。同一列可以分给多个字段。不要编造不存在的列字母。single_exposure 只能对账面余额：Value Balance(MOP)、O/S BAL_MOP、Equiv to MOP、信貸敞口_MOP、剩余可使用额度（澳门元）。抵押品价值、Collateral Value、利息、RWA、风险权重、CCF、合同号、客户号都不是 single_exposure。Cust Type、INDUSTRY、客户类型对 counterparty_type。存放同业整表是商业银行，不要写成主权。信用卡整表是自然人，并且 is_credit_card 为 yes。贷款、按揭、透支、额度、信用卡的 fi_bank_applicable 为 not_applicable。原始期限对 Rest Period、Original Period、BY PERIOD (DAYS)，这些数是天数。不要对到期日。五级分类、DPD、逾期天数对 is_defaulted。底稿没有的财务和资本条件写 missing，不要整表填 yes。抵押品描述对 property_uses 和 has_property_collateral。不要把风险权重、RWA、合同号、客户号当成分类字段。
```

程序怎么用返回值：

- 每个字段都要有一条。模型没给的，记成 `status: missing`。
- `column` 必须是这次表头里的列字母，否则不当成列。
- `const` 原样收下，不在这里核对是不是 `options` 里的 code。
- `extract` 最多留 240 字，不参与计算。

`paper_calc._repair_mapping` 写了纠正规则，但当前没有任何地方调用它。已知表的纠正在 `_strong_bind`。

## 3. 规则停住后补条件

函数：`paper_calc.py` 的 `_open_weight_system`。调用：`_ask_open_weights`，由 `_fill_open_weights` 使用。

只处理权重还不是数字、并且 `_open_kind` 认得出种类的行。种类和允许的 `choice`：

| kind | 何时 | options |
|---|---|---|
| `bank_grade` | 走到的类型或分类文字含「商业银行」，或 `counterparty_type` 已是 `commercial_bank` | `a_plus`、`a`、`b`、`c` |
| `default_provision` | 文字含「已违约」，且这行没有 `provision_ratio` | `high`、`low` |

文字含「共同抵押」时 `_open_kind` 返回空，不发给模型。`property_side` 仍写在提示词和 `_OPEN_OPTIONS` 里，当前这条路径不会产生它。已违约的判断在商业银行之前。

用户消息是 `{"cases":[...]}`。每个 case 有 `id`、`kind`、`options`、`stuck`、`count`、`ead_yi`、`sheets`、`names`（最多 4 个）、`external_rating`、`maturity_months`（最短和最长，月）、`collateral`（最多 3 条）。

系统提示原文：

```text
有些信用风险敞口走到了权重法规则，但规则因为缺条件停住了，权重还是空的。你要替这些敞口把缺的条件定下来。只输出一个 JSON 对象，不要解释。格式是 {"choices":[{"id":"原样照抄","choice":"选项之一","reason":"一句为什么这样定"}]}。每一个 case 的 id 都必须出现，choice 只能是该 case 的 options 里的值，不能写权重百分比。bank_grade：底稿没有资本充足率。a_plus 表示核心一级资本充足率不低于 14% 且杠杆率不低于 5%，并满足最低资本和其他各级资本；a 表示满足最低资本和其他各级资本，但达不到 A+；b 表示只满足最低资本、不满足其他各级资本；c 表示不满足最低资本。外部评级只是参考，不能把 AA、A 直接当成资本档次。期限由规则自己处理，不要用档次去表示期限。property_side：居住和商用同时抵押，规则要求先选定一边。residential 归居住用，commercial 归商用。按抵押品描述选更贴近的一边。default_provision：已违约，但没有这笔的减值准备，规则分不出 100% 和 150%。high 表示按损失准备不低于账面 20%，权重 100%；low 表示按损失准备低于账面 20%，权重 150%。信用卡未使用额度通常没有单独计提，更接近准备不足。
```

程序只收下 `id` 对得上、且 `choice` 在该 case 的 options 里的项。然后 `_apply_open_choice` 写回事实，再跑一遍分类：

- `a_plus`：`meets_minimum_capital=yes`，`meets_other_capital=yes`，`cet1_ratio=0.14`，`leverage_ratio=0.05`
- `a`：两项资本要求都是 yes，不写比率
- `b`：最低资本 yes，其他各级 no
- `c`：最低资本 no
- `high`：`provision_ratio=0.2`
- `low`：`provision_ratio=0.0`

写回后权重仍不是数字的，保持未定，不另造一个权重。原因记在该行 `_model_reason`，汇总进结果的 `model_note`。
