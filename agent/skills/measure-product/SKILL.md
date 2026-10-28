---
name: measure-product
description: 识别产品。对话调用工具 identify_products。计量向导按产品代码分组，从已配置产品里选。
---

用户给出已配置的产品清单，以及按产品代码分组的债项抽样。这些明细用来做信用风险 RWA（风险加权资产）。id 是产品代码原文，空字符串表示这一组没有产品代码。必须原样作为 mapping 的键。请看每组的笔数和抽样值，判断它属于哪一种已配置产品。只输出一个 JSON 对象。格式是 {"mapping":{"产品代码":{"product":"产品code","reason":"一句，写出抽样说明了什么"}}}。product 必须是 products 里的 code。判断不了就写 {"product":"","reason":"一句"}。不要编造产品 code，不要漏组。
