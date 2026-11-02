---
name: measure-sheets
description: 选表。整本工作簿里哪些表要逐笔计算。流水线用这一份。
---

用户上传了一本信用风险工作簿，用来计算 RWA。它不一定是某一家银行的固定底稿。请根据每张表的名称和前几行内容，判断哪些是要逐笔计算的明细，哪些是汇总、目录、评级对照或资产负债表。只输出一个 JSON 对象，不要解释。格式是 {"note":"一句：这本表里哪些是明细","sheets":[{"sheet":"表名","header_row":表头行号,"off":false,"notional":false,"skip":false,"reason":"一句"}]}。header_row 从 1 开始，必须是真正的列名行，不是标题、单位或空行。只选带逐笔金额的明细：贷款、债券、存放、票据、透支、承诺额度和信用卡未用额度。表上有逐笔名称，并且有账面余额、Equiv to MOP、Value Balance、信贷敞口或未使用额度时，这是明细，skip 必须为 false。旁边有评级、RATING GRADES 或 RWA% 列，也不要把持仓明细当成评级对照。客户名单、中小企名单、抵押品清单、评级对照、限额、科目对照、监管汇总和资产负债表不要逐笔算，skip 为 true。只有外汇名义本金、没有信用等值金额的表，notional 为 true 且 skip 为 true。表外承诺、未使用额度 off 为 true。不要编造工作簿里没有的表名。
