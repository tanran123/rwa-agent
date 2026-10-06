# 外汇互换对手信用风险

id: ccr_fx
类别: 信用风险

## 公式

- 折现轧差 + 流入 × 附加因子 = 信用暴露
- 信用暴露 × 对手权重 = RWA

## 步骤

### 1. 远端两腿轧差

- 字段: far_ccy_1、far_amt_1、far_ccy_2、far_amt_2、residual_months
- 说明: 一正一负。折现后取流入减流出，小于 0 则为 0。

### 2. 加附加因子

- 字段: residual_months
- 说明: 不超过 12 个月为 1%，不超过 60 个月为 5%，更长为 7.5%。

### 3. 乘对手权重

- 字段: counterparty_type、rating_fitch、counterparty_name
- 说明: 银行按一般档，用 Fitch 评级查权重。

## 参数

| 名称 | 标识 | 值 |
| --- | --- | --- |
| 短期限上限（月） | cut_short | 12 |
| 短期限附加因子 | ccf_short | 1% |
| 中期限上限（月） | cut_mid | 60 |
| 中期限附加因子 | ccf_mid | 5% |
| 更长期限附加因子 | ccf_long | 7.5% |
| 资本比例 | capital_ratio | 8% |
