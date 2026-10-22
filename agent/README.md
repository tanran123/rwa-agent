# 智能体

目录按 deepagents 的项目布局。总控的提示在 `AGENTS.md`，配置在 `agent.json`。每个计算步骤目录里有自己的 `agent.json` 和 `AGENTS.md`。技能在 `skills/<名字>/SKILL.md`。

页面通过 `POST /api/agent/chat` 进来。Koa 转到 Flask，Flask 调用 `harness.reply`。总控只派发，不自己算数。

生成一步之前先看根目录 `README.md`。分类 JSON 在 `subagents/weight/knowledge/`。表内和表外 EAD 配置在 `subagents/ead/knowledge/`，由页面读写，不进 `STEPS`。留痕在仓库根目录 `output/traces/`，结果工作簿在 `output/workbooks/`。不要再复制一份分类 JSON。

这里有五块，互不替代：

| 块 | 路径 | 做什么 |
| --- | --- | --- |
| 总控 | 本目录根上的 Python | 对话、派发、打开页面。 |
| 流水线 | `subagents/weight`、`ccf`、`crm`、`rwa` | 信用风险按顺序计算。名单在 `pipeline.py` 的 `STEPS`，当前只有 `weight`。 |
| 底稿页 | `subagents/weight/paper/` | 读同目录 `底稿模型计算.json`。不进 `STEPS`。 |
| 规则库 | 仓库根目录 `knowledge/` | 本地规则在 `local/`，微信知识库对话在 `weknora/`。见 `knowledge/README.md`。 |
| 市场风险 | `subagents/rwa/market/` | 回购和市场风险公式。不进 `STEPS`。信用风险汇总仍是 `rwa/program.py`。 |

## 总控

| 路径 | 作用 |
| --- | --- |
| `agent.json` | 总控的名字、说明和模型。 |
| `AGENTS.md` | 总控提示词。`harness.py` 启动时读这一份。 |
| `harness.py` | 组装 deepagents，处理对话，返回 `{ reply, pages }`。EAD 页带上配置时，回复里的 JSON 草稿放在 `draft`。 |
| `layout.py` | 读取 `agent.json` 和 `AGENTS.md`。 |
| `chat.py` | 通义模型。密钥读仓库根目录 `.env`。 |
| `pipeline.py` | `STEPS` 名单。按名单调用 `program.run`。 |
| `pages.py` | 总控打开页面。只在用户要看页面时用。 |
| `tree_edit.py` | 决策树对话先说明当前规则，再给出修改 JSON。不写文件。用户确认并选择保存后，由 Koa 写入。 |
| `paths.py` | 仓库根目录。留痕目录从这里找。 |
| `skills/calculation-order/SKILL.md` | 计算顺序。总控和子智能体都能读。 |
| `subagents/__init__.py` | `ORDER`。顺序是 weight、ccf、crm、rwa，不能调换。 |

## 流水线

在仓库根目录执行 `python -m agent.pipeline 工作簿.xlsx`。`STEPS` 里没有的步骤停住。

| 步骤 | 目录 | 现在 |
| --- | --- | --- |
| `weight` | `subagents/weight/` | 会跑工作簿。实现是 `program.py`，计算在 `calc/`。 |
| `ccf` | `subagents/ccf/` | 表外转换系数。`program.run` 停住。 |
| `crm` | `subagents/crm/` | 缓释。`program.run` 停住，也不改原来的权重。 |
| `rwa` | `subagents/rwa/` | 按留痕汇总。`program.run` 停住。 |

`ccf` 只处理表外，等值金额 = 名义金额 × 转换系数。`crm` 把覆盖部分和未覆盖部分拆开。`rwa` 按留痕汇总。这三步不要在对话或工具里编造系数、拆分或另一套金额。

### weight/calc

| 路径 | 作用 |
| --- | --- |
| `weight/agent.json`、`weight/AGENTS.md` | 这一步的说明和提示词。 |
| `weight/__init__.py` | 工具 `run_weight_decision`。 |
| `weight/program.py` | `run(context)`。把工作簿交给 `calc/paper_calc.run_workbook`，把结果路径、留痕、敞口和风险加权资产放回 context。 |
| `weight/calc/paper_calc.py` | 逐笔分类、权重和敞口。 |
| `weight/calc/exposure_class.py` | 把分类 JSON 收成决策树。 |
| `weight/calc/calc_trace.py` | 写计算留痕。文件在仓库根目录 `output/traces/`。 |
| `weight/calc/model.py` | 用通义把表头对到分类字段。 |
| `weight/calc/paths.py` | `ROOT` 指向 `weight/`，用来找分类 JSON。密钥在仓库根目录 `.env`。`OUTPUT` 指向仓库根目录 `output/`。 |
| `weight/knowledge/` | 分类规则。计算读 `权重法风险暴露分类.json`。写法见同目录 `风险暴露分类配置说明.md`。 |
| `weight/samples/` | 试算底稿。 |

### weight/paper

底稿页用的权重计算。Flask 的底稿接口读这里。缓存是同目录 `底稿模型计算.json`。

| 路径 | 作用 |
| --- | --- |
| `paper/paper_calc.py` | 把底稿明细对到分类字段，再按决策树计算。 |
| `paper/working_paper.py` | 从信用风险底稿读出已经算好的风险加权资产。 |
| `paper/calc_trace.py` | 把这次底稿计算写成 `output/traces/`。 |
| `paper/clarify.py` | 底稿里拿不准的列，交给模型提问。 |
| `paper/exp_flow_gen.py` | 按产品字段生成分类流程，并标出缺的字段。 |

### ccf 和 crm

各有 `agent.json`、`AGENTS.md`、`__init__.py`、`program.py`。问到就停住。不要在这里补系数或拆分。

### rwa

`program.py` 按留痕汇总。这一步还没进 `STEPS`，`run` 停住。

`rwa/market/` 是回购和市场风险的公式计算，给 Flask 的上传和对比接口用。

| 路径 | 作用 |
| --- | --- |
| `market/agent.py` | 选定公式包并计算。 |
| `market/formulas.py` | 正回购、外汇互换、回购利率、利率互换、外汇净敞口。 |
| `market/fields.py` | 公式用的字段和表头别名。 |
| `market/reference.py` | 公式里的参照表。 |
| `market/rule_calc.py` | 按已写好的规则和映射列计算。 |
| `market/mapper.py` | 把上传表头对到公式字段。 |
| `market/weight_tables.py` | 从上传工作簿收集到的权重。 |
| `market/compare.py` | 把计算结果收成监管报表并对比。 |

## 一个子智能体里有什么

`agent.json` 写 `description`，总控靠它决定何时派发。`AGENTS.md` 是这一步的提示词。

`__init__.py` 提供工具和 `spec(model)`。提示词从上面两个文件读，不要再写死在 Python 里。

`program.py` 给流水线调用：

- `NAME`、`DETAIL`
- `status()`：给 `pipeline_steps` 用的一行说明
- `explain()`：这一步被单独问到时的原文。还没实现就明确停住
- `run(context) -> context`：真正计算。缺字段就设 `context["stopped"] = True` 和 `context["stop_reason"]`，不要补一个数

`context` 至少有 `source`（工作簿路径）。返回时保留 `annotated`、`trace_file`、`ead_yi`、`rwa_yi`。后两个单位是亿元。

## 写计算步骤时以哪个文件为准

`STEPS` 只看 `agent/pipeline.py`。当前文件里没有的步骤名，就还不能执行。不要在对话、工具或前端里补一个系数或金额。

分类条件和权重只改 `subagents/weight/knowledge/权重法风险暴露分类.json` 里用户点名的规则。`when` 的 `field` 和 `match` 用该文件 `options` 里已有的 `code`。空单元格保持不命中，不要为了算完填一个权重。

子智能体的说明写在该目录 `agent.json` 的 `description`，提示写在该目录 `AGENTS.md`。`__init__.py` 只保留工具函数和 `spec()`，并从 `agent/layout.py` 的 `subagent_prompt` 读取这两份文件。

`run(context)` 缺路径或缺少必要字段时，设置 `stopped` 和 `stop_reason` 后返回。不要估算敞口或风险加权资产。`ead_yi` 和 `rwa_yi` 只从 `run_workbook` 的返回值抄过来。流水线这一步的 `run_workbook` 在 `weight/calc/paper_calc.py`。

能打开的页面只有 `agent/pages.py` 的 `PAGES`：`/engine`、`/results`、`/wizard`。不要给 `open_page` 增加没在前端路由里出现的路径。

## 加一步

1. 新建 `subagents/<名字>/`，放入 `agent.json`、`AGENTS.md`、`program.py` 和 `__init__.py`。
2. 把这一步加进 `subagents/__init__.py` 的 `ORDER`，位置按监管计算顺序。
3. 在总控 `AGENTS.md` 里写明什么问题交给它。
4. `program.run` 能用真实输入跑通之后，才把名字追加到 `agent/pipeline.py` 的 `STEPS`。没跑通不要写进名单。
5. 改完 Python 执行 `pm2 restart rwa-agent`。进程里的图是启动时建的，不重启仍是旧的。
