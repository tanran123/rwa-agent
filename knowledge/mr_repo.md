# 回购利率市场风险

id: mr_repo
类别: 市场风险

## 公式

- 市值 × 特定风险 + 市值 × 期限档 = 资本
- 资本 × 12.5 = RWA

## 步骤

### 1. 特定风险

- 字段: mv_mop、issuer_category
- 说明: 政府类 0%，投资级企业 1%。

### 2. 期限档

- 字段: residual_months、trade_id
- 说明: 用剩余期限查期限档权重，再乘市值。

## 参数

| 名称 | 标识 | 值 |
| --- | --- | --- |
| 政府类特定风险 | specific_gov | 0% |
| 投资级特定风险 | specific_ig | 1% |
| RWA 倍数 | rwa_multiplier | 12.5 |
