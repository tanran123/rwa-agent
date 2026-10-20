# 智能体

目录按 deepagents 的项目布局。总控的提示在 `AGENTS.md`，配置在 `agent.json`。每个子智能体目录里有自己的 `agent.json` 和 `AGENTS.md`。技能在 `skills/<名字>/SKILL.md`。

页面通过 `POST /api/agent/chat` 进来。Koa 转到 Flask，Flask 调用 `harness.reply`。总控只派发，不自己算数。

生成一步之前先看根目录 `README.md`。分类 JSON 在 `交付/exposure-weight-decision/knowledge/`。留痕在仓库根目录 `output/traces/`，结果工作簿在 `output/workbooks/`。不要把分类 JSON 复制进子智能体目录。

## 目录

| 路径 | 作用 |
| --- | --- |
| `agent.json` | 总控的名字、说明和模型。 |
| `AGENTS.md` | 总控提示词。`harness.py` 启动时读这一份。 |
| `skills/calculation-order/SKILL.md` | 计算顺序。总控和子智能体都能读。 |
| `harness.py` | 组装 deepagents，处理对话，返回 `{ reply, pages }`。 |
| `layout.py` | 读取 `agent.json` 和 `AGENTS.md`。 |
| `chat.py` | 通义模型。密钥读仓库根目录 `.env`，没有再读交付目录 `.env`。 |
| `pipeline.py` | 读取交付目录 `rwa_agent/pipeline.py` 里的 `STEPS`，按名单调用 `program.run`。 |
| `pages.py` | 总控打开页面。只在用户要看页面时用。 |
| `subagents/__init__.py` | `ORDER`。顺序是 weight、ccf、crm、rwa，不能调换。 |
| `subagents/weight/` | 风险暴露权重判断。当前名单里只有这一步会跑工作簿。 |
| `subagents/ccf/` | 表外转换系数。程序还没实现，问到就停住。 |
| `subagents/crm/` | 缓释。程序还没实现，问到就停住，也不改原来的权重。 |
| `subagents/rwa/` | 按留痕汇总风险加权资产。程序还没实现，问到就停住。 |

## weight

| 路径 | 作用 |
| --- | --- |
| `weight/agent.json`、`weight/AGENTS.md` | 这一步的说明和提示词。 |
| `weight/__init__.py` | 工具 `run_weight_decision`。 |
| `weight/program.py` | `run(context)`。把工作簿交给 `calc/paper_calc.run_workbook`，把结果路径、留痕、敞口和风险加权资产放回 context。 |
| `weight/calc/paper_calc.py` | 逐笔分类、权重和敞口。 |
| `weight/calc/exposure_class.py` | 把分类 JSON 收成决策树。 |
| `weight/calc/calc_trace.py` | 写计算留痕。文件在仓库根目录 `output/traces/`。 |
| `weight/calc/model.py` | 用通义把表头对到分类字段。 |
| `weight/calc/paths.py` | `ROOT` 指向交付目录，用来找分类 JSON 和 `.env`。`OUTPUT` 指向仓库根目录 `output/`，留痕在 `traces/`，结果工作簿在 `workbooks/`。 |

交付目录里的 `rwa_agent/paper_calc.py`、`exposure_class.py`、`calc_trace.py`、`model.py`、`steps/weight.py` 只转到这里。命令 `python -m rwa_agent.pipeline 工作簿.xlsx` 仍在交付目录执行，实际跑的是 `weight/program.py`。

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

`STEPS` 只看 `交付/exposure-weight-decision/rwa_agent/pipeline.py`。当前文件里没有的步骤名，就还不能执行。不要在对话、工具或前端里补一个系数或金额。

分类条件和权重只改 `交付/exposure-weight-decision/knowledge/权重法风险暴露分类.json` 里用户点名的规则。`when` 的 `field` 和 `match` 用该文件 `options` 里已有的 `code`。空单元格保持不命中，不要为了算完填一个权重。

子智能体的说明写在该目录 `agent.json` 的 `description`，提示写在该目录 `AGENTS.md`。`__init__.py` 只保留工具函数和 `spec()`，并从 `agent/layout.py` 的 `subagent_prompt` 读取这两份文件。

`run(context)` 缺路径或缺少必要字段时，设置 `stopped` 和 `stop_reason` 后返回。不要估算敞口或风险加权资产。`ead_yi` 和 `rwa_yi` 只从 `run_workbook` 的返回值抄过来。

能打开的页面只有 `agent/pages.py` 的 `PAGES`：`/engine`、`/results`、`/wizard`。不要给 `open_page` 增加没在前端路由里出现的路径。

## 加一步

1. 新建 `subagents/<名字>/`，放入 `agent.json`、`AGENTS.md`、`program.py` 和 `__init__.py`。
2. 把这一步加进 `subagents/__init__.py` 的 `ORDER`，位置按监管计算顺序。
3. 在总控 `AGENTS.md` 里写明什么问题交给它。
4. `program.run` 能用真实输入跑通之后，才把名字追加到交付目录 `rwa_agent/pipeline.py` 的 `STEPS`。没跑通不要写进名单。
5. 改完 Python 执行 `pm2 restart rwa-agent`。进程里的图是启动时建的，不重启仍是旧的。

`ccf` 只处理表外，等值金额 = 名义金额 × 转换系数。`crm` 把覆盖部分和未覆盖部分拆开，不改原来的风险权重。`rwa` 按留痕汇总。这三步的 `run` 现在只停住。不要在对话或工具里编造系数、拆分或另一套金额。
