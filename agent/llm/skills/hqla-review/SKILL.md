---
name: hqla-review
description: 流动性 HQLA 判定的业务口径。用户问某只证券为什么算或不算 HQLA、Level 1/2A/2B 怎么分、第 5 步外部数据怎么命中、或要看判定摘要时使用。
---

# 流动性 HQLA / LCR 判定

## 当前向导的七步

1. 基本信息与规则版本（锁定 `ruleVersion`、`jurisdiction`、`lcrVersion` 和六项版本快照）
2. Excel 数据导入（按 Sheet 解析成数据集）
3. 产品自动识别（以数据集为单位匹配流动性产品）
4. 标准字段 Mapping（Excel 表头对到产品标准字段）
5. 数据质量检查（字段完整性、金额格式、重复、负值）
6. 自动计量计算（按产品侧别查参数表，汇总 HQLA / 现金流入 / 现金流出 / LCR）
7. 结果复核与输出（产品结果、单笔追溯、CSV 导出、归档）

产品、标准字段、规则、折扣率/流入率/流出率和上限参数都来自当前监管规则版本的流动性产品管理（`liquidity_product` 等表）。计算入口是 `agent/core/hqla/lcr.py`。

## 旧判定引擎（不在当前向导中）

仓库仍保留按证券逐只判定的旧引擎，用于历史任务和摘要工具：

1. 明细全量导入
2. 内部清单（交易账簿、质押、关联方、政策性银行、结构性债、RMBS 批准）
3. 判定标准配置（关卡一排除、关卡二分档、关卡三上限）
4. 抽样（全量 / 属性抽样 / 固定样本）
5. 外部数据获取
6. 逐笔核对与证据链
7. 汇总重编与对账

## 第 5 步的真实口径（旧引擎）

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

- 当前 LCR 计算：`agent/core/hqla/lcr.py`
- 工作簿解析：`agent/core/hqla/service.py`
- 判定（旧）：`agent/core/hqla/judge.py`
- 编排：`agent/core/hqla/service.py`
- 配置：`agent/core/hqla/engine.py`
- 导出：`agent/core/hqla/export.py`
