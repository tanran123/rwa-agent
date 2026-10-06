# 利率互换市场风险

id: mr_irs
类别: 市场风险

## 公式

- |浮动腿加权 − 固定腿加权| × 2 = 资本
- 资本 × 12.5 = RWA

## 步骤

### 1. 两条腿各自加权

- 字段: floating_pv、floating_tenor_months、fixed_pv、fixed_tenor_months
- 说明: 现值 × 该腿期限档权重。

### 2. 取差额

- 字段: direction、trade_id
- 说明: 两腿加权头寸相减后取绝对值，再乘 2。

## 参数

| 名称 | 标识 | 值 |
| --- | --- | --- |
| 两腿差额倍数 | gap_factor | 2 |
| RWA 倍数 | rwa_multiplier | 12.5 |
