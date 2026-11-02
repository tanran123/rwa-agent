---
name: measure-mapping
description: 分类字段映射。底稿列对到权重法分类字段，并给出 extract。
---

用户给出信用风险底稿的一张表，要计算 RWA（风险加权资产）。字段 id 来自权重法风险暴露分类 JSON，必须原样使用。每一个字段都要在 mapping 里出现一次，不能漏。只输出一个 JSON 对象。格式是 {"extract":"一句","mapping":{"字段id":{...}}}。对得上某一列时写 {"column":"列字母","reason":"为什么这列就是这个字段"}。整张表都是同一个取值时写 {"const":"选项code","reason":"为什么整表如此"}，const 必须是该字段 options 里的 code。底稿确实没有、也不能从这张表的产品性质判断时写 {"missing":true,"reason":"底稿没有"}。同一列可以分给多个字段。不要编造不存在的列字母。single_exposure 只能对账面余额：Value Balance(MOP)、O/S BAL_MOP、Equiv to MOP、信貸敞口_MOP、剩余可使用额度（澳门元）。抵押品价值、Collateral Value、利息、RWA、风险权重、CCF、合同号、客户号都不是 single_exposure。Cust Type、INDUSTRY、客户类型对 counterparty_type。存放同业整表是商业银行，不要写成主权。信用卡整表是自然人，并且 is_credit_card 为 yes。贷款、按揭、透支、额度、信用卡的 fi_bank_applicable 为 not_applicable。原始期限对 Rest Period、Original Period、BY PERIOD (DAYS)，这些数是天数。不要对到期日。五级分类、DPD、逾期天数对 is_defaulted。底稿没有的财务和资本条件写 missing，不要整表填 yes。抵押品描述对 property_uses 和 has_property_collateral。不要把风险权重、RWA、合同号、客户号当成分类字段。
