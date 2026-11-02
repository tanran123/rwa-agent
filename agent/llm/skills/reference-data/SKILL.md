---
name: reference-data
description: 外部债券参考库的口径。用户问 HQLA 第 5 步为什么没命中、参考库有哪些字段、手工补录写到哪时使用。
---

# 外部债券参考库

## 数据

- 表：`hqla_reference`（MySQL），由 Koa 读写；Flask 只接收整包 `reference`。
- 当前库内 476 行与 `server/data/hqla_demo.cjs` 的演示快照一致，仓库里没有灌数脚本。
- 手工补录走 `POST /api/hqla/reference`，`ON DUPLICATE KEY UPDATE` 只覆盖 `name/issuer/rating/rw/p30/mat/ccy`。

## 匹配

- 主键 `id` 是归一化的 `组合|证券代码`。
- 判定只用 code 匹配；ISIN 兜底没有在 `judge.run` 里启用。
- 参考库字段变化不会触发第 5 步的 stale 提示，stale 只看样本索引和参考库行数。

## 禁止

- 不要编造参考库里的评级、权重或价格。
- 不要把参考库说成实时外部接口。

## 文件指针

- `server/src/hqla.js`
- `agent/core/hqla/judge.py`
- `server/data/hqla_demo.cjs`
