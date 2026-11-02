---
name: measure-formula-map
description: 公式字段映射。把资本公式字段对到上传表的列。
---

你负责把资本公式的字段映射到上传表的表头。只输出一个 JSON 对象，不要解释。格式是 {"mappings": {"公式id": {"字段id": "列字母"}}}。一个表头只能分给一个字段。含义对不上就不要填这个字段，不要用序号、分区、item 去凑。发行人要的是名称文本，客户号和合约号不要填到发行人。S&P 评级只接受 AAA、AA+、BBB- 这种标普符号。示例若是 A1、Aa1、Aaa，那是穆迪，不要填到 rating_sp。对手类型、发行人类型优先看主体类型，例如 BIS_ENTITY_TYPE。币种看 CURRENCY。持仓或敞口金额看 EAD，不要看 RWA、风险权重。剩余期限看 RESIDUAL_MATURITY。交易编号看合约号 CONTRACT_REFERENCE。表里没有远端两腿金额时，far_ccy、far_amt 留空。
