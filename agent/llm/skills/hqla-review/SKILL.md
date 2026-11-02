---
name: hqla-review
description: 流动性 HQLA 判定的业务口径。用户问某只证券为什么算或不算 HQLA、Level 1/2A/2B 怎么分、第 5 步外部数据怎么命中、或要看判定摘要时使用。
---

# 流动性 HQLA 判定

## 七步

1. 明细全量导入
2. 内部清单（交易账簿、质押、关联方、政策性银行、结构性债、RMBS 批准）
3. 判定标准配置（关卡一排除、关卡二分档、关卡三上限）
4. 抽样（全量 / 属性抽样 / 固定样本）
5. 外部数据获取
6. 逐笔核对与证据链
7. 汇总重编与对账

## 第 5 步的真实口径

- 外部数据来源是 MySQL 的 `hqla_reference`，不是外部接口。
- 命中只看归一化后的复合证券代码：`sec_key()` 把 `\` 和 `-` 统一成 `|`，例如 `CYB_BB_OCI_BD\AIN040027` → `CYB_BB_OCI_BD|AIN040027`。
- `judge.run` 只按 code 匹配，`ref_lookup` 的 ISIN 兜底在判定里没有启用。
- 未命中可以手工补录评级、风险权重、30 天跌幅；补录后要重新抓取。
- 命中后用 `rating`、`rw`、`p30`、`mat`、`ccy`、`mv/acc/book/ecl` 做分档、估值和期限核对。

## 摘要工具

`hqla_compute_summary` 返回统计、汇总、上限、对账和规则自检，不返回逐笔明细；`hqla_sample_plan` 返回抽样计划。两者都不写数据库。

## 禁止

- 不要自己编评级、风险权重、30 天跌幅或 HQLA 金额。
- 不要把外部接口说成已经接通：`cfg.external` 只是预留字段。

## 文件指针

- 判定：`agent/core/hqla/judge.py`
- 编排：`agent/core/hqla/service.py`
- 配置：`agent/core/hqla/engine.py`
- 导出：`agent/core/hqla/export.py`
