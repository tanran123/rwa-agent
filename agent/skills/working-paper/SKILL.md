---
name: working-paper
description: 信用风险底稿页的口径。用户问底稿缓存有多少行、敞口、RWA、覆盖字段，或底稿页为什么显示某个数时使用。
---

# 信用风险底稿页

## 数据

- 缓存文件：`agent/subagents/weight/paper/底稿模型计算.json`。
- `GET /api/working-paper` 只读这份缓存，不重算；`server/src/paper.js` 也直接读它。
- 缓存里的顶层字段：`file`、`as_of`、`unit`、`ead_yi`、`rwa_yi`、`rwa_thousand`、`lines`、`process_rows`、`sheets`、`sheet_plan`、`coverage`。
- `ead_yi` 和 `rwa_yi` 的单位已经是**亿元**，不是万元。转述时优先用工具返回的 `summary` 原文。

## 工具

`working_paper_summary` 只读缓存并返回摘要，不调用模型、不写文件。

## 禁止

- 不要调用 `load_or_compute()` 或重算底稿；那会触发模型和写缓存。
- 底稿页和整表计算是两套独立实现，不要互相替代。

## 文件指针

- `agent/subagents/weight/paper/paper_calc.py`
- `agent/subagents/weight/paper/working_paper.py`
- `server/src/paper.js`
