---
name: credit-rwa-pipeline
description: >-
  按固定顺序做风险暴露权重决策，以及后续的表外转换系数、缓释和风险加权资产。在用户说按顺序计算、跑流水线、算一整张工作簿，或修改 agent/subagents、交付/exposure-weight-decision/rwa_agent/pipeline.py 时使用。
---

# 风险暴露权重决策流水线

每一步的程序在 `agent/subagents/步骤名/`。名单仍在 `交付/exposure-weight-decision`。整表计算只走这条命令：

```bash
python -m rwa_agent.pipeline 你的工作簿.xlsx
```

第二个参数是结果 Excel 的路径。顺序写在 `rwa_agent/pipeline.py` 的 `STEPS`。不要在对话里自行决定先算哪一步，也不要跳过名单里的步骤。

当前名单只有 `weight`（分类、权重、敞口，规则在 `knowledge/权重法风险暴露分类.json`）。这一步的维护方式见技能 `credit-rwa-weight`。

计划中的后续步骤，模块和规则还没有时不要加进 `STEPS`，也不要编造结果：

1. `ccf`：只处理表外，等值金额 = 名义金额 × 转换系数。
2. `crm`：把覆盖部分和未覆盖部分拆开，不改原风险权重。规则是分类 JSON 里 `rules` 的 `crm_split`。缺覆盖金额、币种或抵押品类型时停，不要编一个拆分。
3. `rwa`：按留痕汇总风险加权资产。

## 加一步

1. 新建 `agent/subagents/步骤名/program.py`，提供 `run(context) -> context`。这一步的说明和工具放在同目录 `__init__.py`。
2. 从上一步留下的 `trace_file` 读取留痕，只追加本阶段的步骤。缺必要字段时设置 `context["stopped"] = True` 和 `context["stop_reason"]`，不要补一个数继续往后算。
3. 确认 `run` 可用后，把步骤名按监管计算顺序追加到 `STEPS`。
4. 在 `.cursor/skills/` 为这一步单独写技能。说明里只写这一阶段的触发词和规则文件。

`context` 至少带有 `source`（工作簿路径）。每步返回时保留 `annotated`、`trace_file`、`ead_yi`、`rwa_yi`。`ead_yi` 和 `rwa_yi` 的单位是亿元。

密钥仍只放在该目录 `.env` 的 `DASHSCOPE_API_KEY`。不要把密钥写进回复、日志或技能。`archive/rwa_agent/` 和 `archive/web/` 是另一套，不要拿来改这套结果。
