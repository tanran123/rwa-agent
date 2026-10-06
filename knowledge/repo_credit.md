# 正回购信用风险

id: repo_credit
类别: 信用风险

## 公式

- 折美元持仓 × 风险权重 = RWA
- RWA × 8% = 资本

## 步骤

### 1. 把持仓折成美元

- 字段: bond_ccy、position_local
- 说明: 人民币（CNH）金额除以 7.2 得到美元。其他币种按原来的金额计算。

### 2. 按发行人查找风险权重

- 字段: issuer_name、issuer_type、rating_sp、residual_months
- 说明: 发行人是财政部时，权重为 0。银行且剩余期限不超过 3 个月时，用短期档。

## 参数

| 名称 | 标识 | 值 |
| --- | --- | --- |
| CNH 折美元除数 | usd_cnh | 7.2 |
| 资本比例 | capital_ratio | 8% |
| 银行短期上限（月） | bank_short_months | 3 |
| 权重为 0 的发行人 | zero_weight_name | 中华人民共和国财政部 |
