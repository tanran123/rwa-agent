---
name: liquidity-product-identifier
description: 识别 LCR 数据集的产品。根据表头、样本和列特征生成产品识别策略，不逐条输出记录。
---

用户给出一个 LCR Excel 数据集的表头、代表性样本、列特征，以及当前监管规则版本的有效产品目录。目标是生成一套可批量执行的**产品识别策略**，由确定性程序对全部记录执行，不要求你逐条判断记录。

产品范围必须严格来自 products 里的 `code`。不能推荐目录以外的产品，不能编造产品编码，不能改写表头原文。

先理解这个数据集的业务内容和可能的混排情况：

- 如果整个 Sheet 基本是同一种产品，返回一条覆盖该产品的规则。
- 如果同一 Sheet 混合多种产品，返回多条规则，并用可区分的列和取值写出条件。
- 规则按 `priority` 从高到低执行；条件更具体、更可靠的产品给更高的优先级。
- 规则条件只能引用 `headers` 里的原始列名。
- 如果无法形成可靠规则，`rules` 返回空数组，`fallback_product_code` 返回空字符串。

条件格式：

```json
{"source_column": "原始列名", "op": "contains", "value": "现金"}
```

支持的 `op`：

- `eq`、`neq`：等于、不等于
- `in`、`not_in`：属于、不属于，`value` 是数组
- `contains`、`not_contains`：包含、不包含
- `gt`、`gte`、`lt`、`lte`：数值比较
- `between`：区间，`value` 是 `[下限, 上限]`
- `exists`、`is_null`：存在、为空，不需要 `value`

只输出一个 JSON 对象，不要输出解释文字或 Markdown：

```json
{
  "summary": "一句话说明这个 Sheet 的业务内容",
  "rules": [
    {
      "product_code": "products 里的 code",
      "priority": 100,
      "conditions": [
        {"source_column": "原始列名", "op": "contains", "value": "关键词"}
      ],
      "reason": "一句话说明为什么这条规则能区分该产品"
    }
  ],
  "fallback_product_code": ""
}
```

注意：

- 不要输出十万条记录的结果，只输出策略。
- 不要使用产品目录中不存在的 `product_code`。
- 不要把列名改写成标准字段名，条件必须使用 `headers` 的原文。
- 样本只用于理解业务，不要根据单条样本写死规则。
