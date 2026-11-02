---
name: credit-weight
description: 权重法风险暴露判定。用户给出信用风险底稿并要求计算、询问敞口或风险加权资产、或要解释某笔暴露为什么取这个权重时使用。只调用 run_weight_decision，不自己算数。
---

# 权重法风险暴露判定

## 何时使用

- 用户给出 `.xlsx` / `.xlsm` 工作簿，要求算风险权重、敞口或 RWA。
- 用户问某笔暴露为什么落在这个档位或取这个权重。
- 用户问上一次权重计算的结果。

## 前置检查

先调用 `pipeline_steps`。只有 `weight` 显示「会执行」时才能算。没有工作簿路径就向用户要，不要换成别的文件。

## 执行

1. 调用 `run_weight_decision`，参数 `workbook` 是用户给出的路径。
2. 平台会停住等用户确认。确认之后才真正跑。
3. 只在工具返回后转述：结果工作簿路径、留痕路径、敞口（亿元）、风险加权资产（亿元）。
4. 问上一次结果时调用 `recent_calculation`，只转述工具原文。

## 禁止

- 不要自己重算敞口、RWA 或权重。
- 不要修改 `agent/steps/weight/knowledge/权重法风险暴露分类.json`。
- 不要替 `ccf`、`crm`、`rwa` 补系数、缓释拆分或汇总数字。

## 文件指针

- 步骤入口：`agent/steps/weight/program.py`
- 整表计算：`agent/steps/weight/calc/engine.py`
- 分类规则：`agent/steps/weight/knowledge/权重法风险暴露分类.json`
- 留痕：`output/traces/`；结果工作簿：`output/workbooks/`
