# 分类 JSON 怎么变成决策树

文件：`agent/subagents/weight/calc/exposure_class.py`。规则文件：`agent/subagents/weight/knowledge/权重法风险暴露分类.json`。字段和规则的写法见 `agent/subagents/weight/knowledge/风险暴露分类配置说明.md`。改规则只改这份 JSON。

`load_class_doc` 要求顶层是对象，且 `rules` 是数组。`class_fields` 收集顶层 `fields`，以及每条规则、`children`、`otherwise` 上的 `fields`。同名只留第一次。每条收成 `id`、`label`、`meaning`、`type`、`source`、`options`（最多 40 个，只要有 `code` 的）。`extensions` 不进入字段表，也不进入树。

`prototype_flow` 把 `rules` 按文件顺序变成 `categories`。顶层若有 `otherwise`，接在最后并标 `otherwise: true`。引擎是瀑布：命中就进入子节点，不命中就继续往下。

## 一个节点

`_node`：

- `id` 是规则 `name`，`label` 是中文名。
- 有 `children` 或 `otherwise` 时类型是 `gate`，否则是 `leaf`。
- `otherwise` 转成最后一个子节点，并标 `otherwise: true`。
- `when` 收成 `match`。条件项写成 `{field, op, value}`，`value` 取 JSON 的 `match`，没有则取 `value`。`op` 缺省是 `eq`。
- 叶子才带 `then.risk_weight`。有子节点的规则即使写了 `value`，这一层也不拿来当权重。

`skip` 原样变成节点上的 `{field, op, match}`。`paper_calc._skipped` 用它做比较。跳过的节点即使条件本来会中，也不进入；这一层若因此没有任何命中，`_walk` 返回空列表，调用方就不会落入同层的 `otherwise`。

## 怎么走

`paper_calc._walk` 在同一层从左到右：

1. 先去掉 `skip` 成立的节点。
2. `otherwise` 节点只有在这一层前面没有任何 `when` 命中、也没有「被 skip 掉的节点本来会命中」时才进入。
3. 普通节点要 `_when` 为真才进入。进入后若有子节点就递归。子节点返回空列表表示这一支不能用，继续看同层后面的节点。子节点有结果则路径是「当前节点 + 子路径」。没有子节点就停在当前节点。
4. 整层都不中返回 `None`，分类结果是「未归类」，权重空。

`_when`：`all` 里每一项都真才真，空数组为假。`any` 有一项真就真，空数组为假。组可以嵌套。

`_cond`：字段不在这行事实里、值是 `None` 或空字符串，条件为假。不把空值当成 0 或 no。

比较：

| op | 成立 |
|---|---|
| `eq` | 值相等，或转成字符串后相等 |
| `neq` | 字符串不等 |
| `in` | 实际值等于 `match` 列表中的任一项 |
| `contains` | 实际值是列表，或按逗号拆开的字符串，其中有一项等于期望值 |
| `gt` `gte` `lt` `lte` | 两边都能转成数字后比较。转不成则不成立 |

## 权重

`exposure_class._weight` 只看叶子上的 JSON：

- 有数字 `value`：类型 `const`，数值就是这个比率。`1` 显示 100%，`0.2` 显示 20%。
- `weight.same_as` 等于 `counterparty_ordinary_claim`：类型 `counterparty`。`paper_calc._classify` 再用普通债权事实从最外层走一次。那次强制 `instrument_type=claim`、`treat_as_equity=no`、`is_defaulted=no`、`is_subordinated=no`、`has_property_collateral=no`，并去掉 `property_uses`、`cashflow_dependent`、`ltv`。只再走这一次。
- `weight.greater_of` 是数组。数组里是数字和 `{ "same_as": "counterparty_ordinary_claim" }` 时，类型 `max`。数字当作地板，代码里初始地板是 0.9，数组里的数字会覆盖它。结果是地板和交易对手普通债权权重中较大的一个。交易对手那次没有权重时，只用地板。
- `greater_of` 里是数字和 `{ "field": "字段名" }` 时，类型 `max_field`。结果是该数字和这一行该字段里的权重中较大的一个。字段没有数字时，只用该数字。
- 都没有：类型 `unspecified`，这一行权重未定。

不要在代码里写死某一档的百分比来填这个空。

## 写在规则树里的三条

这三条都在 `rules` 里，`prototype_flow` 会画出来。没有顶层 `special_rules`。

`fi_bank` 的前两个子节点是未评级债权：其他已评级债权权重为 1.5 时权重 1.5；权重为 0.5 或 1 且原始期限不超过 3 个月时，取 1 与 `derived_bank_weight` 的较大者。`bank_peer_weight` 或期限对不上时，这两条不命中，继续按资本档次。

`multiple_assessments` 在 `rules` 末尾。它没有 `when`，分类瀑布不会停在这里。`pick` 仍由计算在走树之前读取。

`crm_split` 也在 `rules` 末尾，自己带 `children`。父节点没有 `when`，权重分类不进入。拆分不改原债务人的权重。
