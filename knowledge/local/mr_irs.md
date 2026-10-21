# 利率互换市场风险

id: mr_irs
类别: 市场风险

## 公式

- |浮动腿加权 − 固定腿加权| × 2 = 资本
- 资本 × 12.5 = RWA

## 步骤

### 1. 浮动腿和固定腿分别加权

- 字段: floating_pv、floating_tenor_months、fixed_pv、fixed_tenor_months
- 说明: 每条腿用现值乘上该腿剩余期限对应的期限档权重。

### 2. 取两腿差额

- 字段: direction、trade_id
- 说明: 两条腿的加权头寸相减，取绝对值，再乘以 2。

## 参数

| 名称 | 标识 | 值 |
| --- | --- | --- |
| 两腿差额倍数 | gap_factor | 2 |
| RWA 倍数 | rwa_multiplier | 12.5 |
