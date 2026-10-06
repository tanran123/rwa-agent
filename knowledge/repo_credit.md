# 正回购信用风险

id: repo_credit
类别: 信用风险

## 公式

- 折美元持仓 × 风险权重 = RWA
- RWA × 8% = 资本

## 步骤

### 1. 持仓换成美元

- 字段: bond_ccy、position_local
- 说明: CNH 除以 7.2，其他币种用原币金额。

### 2. 查风险权重

- 字段: issuer_name、issuer_type、rating_sp、residual_months
- 说明: 财政部为 0。银行且不超过 3 个月走短期档。

## 参数

| 名称 | 标识 | 值 |
| --- | --- | --- |
| CNH 折美元除数 | usd_cnh | 7.2 |
| 资本比例 | capital_ratio | 8% |
| 银行短期上限（月） | bank_short_months | 3 |
| 权重为 0 的发行人 | zero_weight_name | 中华人民共和国财政部 |
