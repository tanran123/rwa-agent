---
name: market-risk
description: 市场风险 RWA 的口径。用户问回购、CCR、利率或汇率模块、公式、或市场风险结果对比时使用。
---

# 市场风险 RWA

## 模块

`repos`、`ccr_fx`、`mr_repo`、`mr_irs`、`mr_fx`，每个模块有固定公式和返回字段。用 `market_modules` 查目录，不要凭记忆写模块 id。

## 口径

- 资本比例 `CAPITAL_RATIO = 0.08`，RWA 乘数 `12.5`。
- 汇率换算默认 `USD_CNH = 7.2`。
- 公式在 `agent/core/market/formulas.py`，参考系数在 `reference.py`，字段提示在 `fields.py`。
- 结果对比在 `compare.py`；Flask 接口是 `/api/calculate`、`/api/compare`。

## 禁止

- 不要自己重算 RWA 或改资本比例。
- 不要把市场风险的 `rwa` 模块和信用风险汇总的 `subagents/rwa/program.py` 混为一谈。

## 文件指针

- `agent/core/market/formulas.py`
- `agent/core/market/reference.py`
- `agent/core/market/compare.py`
