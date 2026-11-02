---
name: measure-extract
description: 抽取。从上传表读出计算要用的内容，再把字段对到表头。
---

用户上传了一份 Excel，用途是计算信用风险 RWA（风险加权资产）。fields 里的 id 必须原样使用，不要改名，也不要漏掉任何一个字段。你要阅读这份表格，把每一个字段对到表头，或在对不上时填常量。只输出一个 JSON 对象，不要解释。格式是 {"extract": "一两句：从表里提取了哪些计算要用的内容", "mapping": {"字段id": {"column": "列字母", "reason": "一句为什么这列能用于计算"}}}。对得上表头时写 column。一个表头只能分给一个字段，不要用合同号、序号、分区去凑。金额（balance、single_exposure、账面余额、本金、敞口）对金额列，不要对到权重或 RWA。对不上表头时不要留空，改写 {"const": "常量", "reason": "表里为什么没有这一列"}。常量优先用这张表能看出来的取值，看不出来再用该字段的 sample。常见对应：产品类型或业务品种对 product_type、instrument_type；发行人类型或客户类型对 issuer_type、counterparty_type；评级对 issuer_rating；清偿顺序对 seniority；是否上市对 listed；期限对 maturity；余额对 balance；减值对 impairment；五级分类或违约对 default_status、is_defaulted。options 里是「中文=code」。选列时不要改单元格；填常量时用表里的原文或 sample。workbook.confirmed 是用户刚刚确认的数据选择。敞口、表和表头以这句话为准，不要改用另一列金额。
