# 智能体


## 分层：确定性计算与模型能力（2026-11 重构）

目录按「要不要调模型」分开，不按监管步骤分。新代码只往这两层写。

| 层 | 路径 | 规则 |
| --- | --- | --- |
| 纯计算 | `agent/core/` | **禁止 import `agent.llm`**。规则树、逐笔计算、留痕、HQLA、市场风险公式、流水线都在这里。 |
| 模型能力 | `agent/llm/` | 唯一能发模型请求的地方。`client.py` 是唯一模型工厂；`capabilities/` 每个能力一个模块；`agents/` 放 DeepAgents 图。 |
| 适配器 | `agent/steps/` | 只保留流水线步骤 `program.py` 和三个 weight 适配器（`calc/engine.py` 工作簿、`paper/engine.py` 底稿、`classify.py` 向导第五步）。 |

`core/weight/engine.py` 是两套底稿引擎里逐字相同的 50 个函数，只此一份。两个适配器各自保留真正不同的部分（输出列数、选表口径、评级、开放权重）。`core/weight/rules.py` 是分类 JSON 的决策树，`core/weight/exposure.py` 是分类执行器（走规则树、取值归一化、多重评级、同一银行权重回写），两者都是纯 Python，**不调模型**。

`core/` 里禁止出现 `runtime_model`、`chat_model`、`complete`、`skill_body`。需要模型时，在 `agent/llm/capabilities/` 加一个模块，capability 用 `create_deep_agent` 建图，输入输出都是 JSON。

2026-11 重构后，旧的兼容壳（`agent/calculation/`、`agent/subagents/hqla/`、`agent/subagents/rwa/market/`、各 `paper_calc.py`、`agent/runtime/`）已经删除。仓库里只剩一套实现，import 直接写 `agent.core.*` 或 `agent.llm.*`。

这一轮有四方。页面把用户的话交给平台。平台入口是 `llm/graph.py`，组装在 `llm/agents/`。模型能力、提示词、技能、会话都放在 `llm/`，检查点与存储在 `storage.py`。工具是 `tools/` 里的函数。

1. 默认用 DeepAgents 的 `create_deep_agent`（`llm/agents/chat.py`）。平台把这句话、`llm/prompts/system_prompt.md`、`tools/` 的名单交给模型；技能不再拼全文，只给 `agent/llm/skills/` 的清单和路径，模型需要时用 `read_file` 读取正文（渐进披露）。
2. 模型若要查进度或要计算，只返回工具名和参数，不自己执行。
3. 工具由 LangGraph 执行，结果再交回模型；计算工作簿前由 `interrupt_on` 停住等页面确认。
4. 模型写成给用户看的话。`llm/session/client.py` 把这句话和 `actions` 交给页面。

`RWA_COORDINATOR_SUBAGENTS=0` 可以不挂四个子智能体，只保留总控工具。改环境变量后要重启 `rwa-agent`。

`decision-tree` 不附在这次请求里。暴露分类页调用模型时，`tree/edit.py` 把那份技能全文当作系统提示。

这些工具是：`pipeline_steps` 看当前算到哪一步，`run_weight_decision` 对一本工作簿做权重判断，`recent_calculation` 读这次进程里上一次权重结果，`ccf_status`、`crm_status`、`rwa_status` 说明后面三步为什么还停着。

用户给出工作簿并要求计算时，平台先停住，页面上出现「将计算工作簿：路径。确认后才会开始计算。」以及确认、取消两个按钮，这时还没有开始算。只有确认按钮把 `confirm: true` 送回来，才真正调用 `run_weight_decision`。取消送 `confirm: false`，不开始算。回复里出现「确认」这两个字不会开始算。这个工具在同一个进程里调用 `core/pipeline/pipeline.py` 的 `run_pipeline`。

`run_pipeline` 按 `subagents/__init__.py` 的顺序走：weight、ccf、crm、rwa。只有写在 `STEPS` 里的步骤会执行。当前只有 `weight`。`weight` 把工作簿交给 `subagents/weight/program.py`，由 `calc/engine.py` 逐笔计算。没有路径，或这一步自己停住，就写下 `stopped` 和 `stop_reason`，后面的步骤不会开始，也不会编一个数。`ccf`、`crm`、`rwa` 的目录还在，因为没有进 `STEPS`，这次不会执行。

从对话里发起时，这次计算记在对话的 `threadId` 后面再加 `::calculation`。检查点写在 `output/runtime/checkpoints.sqlite`。命令行 `python -m agent.core.pipeline.pipeline 工作簿.xlsx` 不经过对话，直接调用同一个 `run_pipeline`，每次另起一个线程号。

生成一步之前先看根目录 `README.md`。分类 JSON 在 `subagents/weight/knowledge/`。表内和表外 EAD 配置在库表 `ead_product_config`、`ead_product_rule`，公式校验在 `server/lib/formula.cjs`，不进流水线名单。留痕在仓库根目录 `output/traces/`，结果工作簿在 `output/workbooks/`。不要再复制一份分类 JSON。

## 一次对话怎么走

页面 `POST /api/agent/chat`，请求体是 `messages`、`page`、`config`、`catalog`，以及上一轮返回的 `threadId`。Koa 原样转到 Flask。Flask 调用 `llm/session/client.py` 的 `reply`。

`reply` 只保留最近 8 条 `user` 或 `assistant` 消息，每条正文截到 800 字，最后一条必须是用户说的话。它在这句前面加上当前页面。带了 EAD 配置时，再把那份 JSON 和修订意见拼进去。`catalog` 是当前页面、这一页的接口和可填写的表单，只放进这一轮的系统提示，不写进检查点。

这一轮在服务里跑完，页面拿到的仍是一次 JSON：`reply`、`pages`、`draft`、`actions`、`threadId`、`confirm`。`pages` 固定是空数组。`confirm` 为真时，页面只显示确认和取消，输入框停用。`actions` 只保留当前页面的步骤，字段来自这次对话。页面把这些字段写入当前表单；`save` 为真时调用这一页已有的保存。删除不在这些步骤里。底稿计算、计量向导、结果明细从左侧菜单进入。右下角对话按当前页面记住 `threadId`，下一句原样送回。

同一条 `threadId` 已经有检查点时，只把这一句新的用户消息追加进去，不把整段历史再写一遍。检查点里的消息超过 16 条时，先删掉更早的，再追加。

上一轮若停在确认上，这一句不作为新消息写入。请求体里的 `confirm` 为真或假时，才把它交给被中断的 `tool_node`。没有这个字段时，中断还在，页面继续显示同一句提示。

`draft` 只在这次请求带了 EAD 配置时，从回复的 JSON 代码块里取出。

## 同一轮对话里记住什么

检查点和上一次计算结果都写在仓库根目录 `output/runtime/`，`pm2 restart rwa-agent` 之后还在。页面上的智能体和计算流水线读同一份 `store.sqlite`，所以两边看到的上一次权重结果是同一份。`output/` 不提交。

| 能力 | 现在怎么用 |
| --- | --- |
| 检查点 | `storage.py` 的 `FileSaver`，文件是 `output/runtime/checkpoints.sqlite`。对话和计算按 `threadId` 保存每一步状态。 |
| 短期记忆 | 同一条 `threadId` 接着上一轮。进入模型前只留最近 16 条检查点消息。 |
| 长期存储 | `storage.py` 的 `SharedStore`，文件是 `output/runtime/store.sqlite`。权重计算成功后，把结果原文放在 `("rwa", "calculation")` 的 `latest`。问上一次结果时，模型调用 `recent_calculation`，只转述这段原文。 |
| 中断 | 模型要调用 `run_weight_decision` 时先停住。回复是「将计算工作簿：路径。确认后才会开始计算。」页面据此显示确认和取消。`confirm` 为真才调用 `run_pipeline`。 |
| 重试 | `llm_call` 的 `RetryPolicy` 是 `max_attempts=2`。仍然失败时，`model_failed` 写入「模型调用失败，没有形成回答。」计算节点不重试，避免同一本工作簿算两遍。 |
| 流式推进 | `reply` 在服务里把这一轮跑完，再读最终状态。HTTP 响应仍是一整段 JSON。 |
| 时间旅行 | `llm/graph.py` 的 `checkpoints(thread_id)` 返回该线程的检查点编号。`fork(thread_id, checkpoint_id, content)` 在那一步追加一条用户消息。`fork` 不会自己再调用模型。 |
| 同一次计算 | `run_weight_decision` 调用 `run_pipeline`。检查点写在同一份 `FileSaver` 上，线程号是 `threadId::calculation`。 |

同步节点不能安全地按墙钟取消，所以 `llm_call` 没有设置节点超时。整轮 HTTP 仍受页面请求超时限制。

模型名在 `agent.json` 的 `runtime.model`。对话和决策树助手读这一项。密钥在仓库根目录 `.env` 的 `DASHSCOPE_API_KEY`，没有则用 `MODEL_API_KEY`。工作簿表头对应仍用 `.env` 的 `MODEL_NAME`，不读 `agent.json`。接口地址要用别的，设 `MODEL_BASE_URL`。

这里有六块，互不替代：

| 块 | 路径 | 做什么 |
| --- | --- | --- |
| 平台 | `llm/`、`llm/agents/`、`llm/session/` | 接收页面的话，默认用 DeepAgents 调用模型、执行工具，把回答交回页面。 |
| 模型能力 | `llm/capabilities/` | 产品识别、字段映射、选表、确认、开放权重、分类流程。每个能力一张 DeepAgents 图。 |
| 流水线 | `core/pipeline/registry.py`，程序在 `subagents/weight`、`ccf`、`crm`、`rwa` | 信用风险按顺序计算。名单在 `registry.ENABLED`，当前只有 `weight`。 |
| 决策树 | `tree/` | 暴露分类页起草修改。不参与右下角对话，也不进流水线名单。 |
| 底稿页 | `subagents/weight/paper/` | 读同目录 `底稿模型计算.json`。不进流水线名单。 |
| 规则库 | 仓库根目录 `knowledge/` | 本地规则在 `local/`，微信知识库对话在 `weknora/`。见 `knowledge/README.md`。 |
| 市场风险 | `subagents/rwa/market/` | 回购和市场风险公式。不进流水线名单。信用风险汇总仍是 `rwa/program.py`。 |

## 平台、模型和工具

| 路径 | 作用 |
| --- | --- |
| `agent.json` | 总控的名字、说明和模型。`llm/settings.py` 读取这一项。要换模型就改这里。密钥仍在仓库根目录 `.env`。 |
| `llm/settings.py` | 统一模型名/密钥/路径。模型工厂在 `llm/client.py`。 |
| `llm/skills/__init__.py` | 唯一 SKILL.md / AGENTS.md 解析器，`SKILLS_DIR` 指向同目录。 |
| `storage.py` | 检查点与共享存储，流水线和对话共用。 |
| `core/paths.py` | 仓库根目录与共享数据路径。留痕目录从这里找。 |
| `llm/prompts/system_prompt.md` | 信用风险总控说明。默认只放角色、边界和工具路由；技能正文由 SkillsMiddleware 按需披露。 |
| `tools/` | 工具名单：`pipeline_steps`、`run_weight_decision`、`recent_calculation`、`ccf_status`、`crm_status`、`rwa_status`、`page_actions`、`identify_products`、`map_fields`、`working_paper_summary`、`hqla_compute_summary`、`hqla_sample_plan`、`market_modules`、`exposure_class_summary`。平台用这一份。`page_actions` 记下当前页要填或要保存的步骤，页面再执行。`identify_products` 和 `map_fields` 复用计量向导的识别和标准字段映射。 |
| `tools/domain.py` | 只读摘要工具：底稿缓存、HQLA 判定/抽样、市场风险模块目录、暴露分类计数。不重算、不写库；重模块在函数内延迟导入。 |
| `llm/graph.py` | 图入口：转 `llm/agents/chat.py` 的 `create_deep_agent`。检查点和存储在 `output/runtime/`。`langgraph.json` 的 `graphs.rwa` 指向这里的 `agent`。 |
| `llm/session/client.py` | 页面进来的一次会话。`reply` 返回 `{ reply, pages, threadId, confirm, actions }`，`pages` 固定是空数组。带上 EAD 配置时，回复里的 JSON 草稿放在 `draft`。`actions` 来自工具 `page_actions`，回复正文里的 actions JSON 会去掉。同一条 `threadId` 接着上一轮；若上一轮停在确认，这一轮只看请求体里的 `confirm`。 |
| `llm/session/turn.py` | 这一轮的页面和接口清单，以及 `page_actions` 记下的步骤。清单由 `TurnContextMiddleware` 注入系统提示，不放进检查点。 |
| `llm/prompts/layout.py` | 读取 `llm/prompts/system_prompt.md` 和 `llm/prompts/agents/<名字>/AGENTS.md`。技能正文由 SkillsMiddleware 按需披露。 |
| `llm/agents/chat.py` | 默认总控：`create_deep_agent` + 只读 `SkillsBackend` + `TurnContextMiddleware` + `interrupt_on`。 |
| `llm/agents/skills_backend.py` | 只读后端，只允许读 `/skills/`，写入和删除一律拒绝。 |
| `llm/session/turn_middleware.py` | 每次模型调用前把当前页面清单追加到系统提示。 |
| `llm/skills/` | 每个子目录一份 `SKILL.md`。DeepAgents 只把名字和描述放进系统提示，正文由模型按需 `read_file`。 |
| `llm/prompts/agents/` | 各步说明。每个子目录一份 `AGENTS.md`。 |
| `llm/skills/calculation-order/SKILL.md` | 计算顺序。右下角对话按需读取。 |
| `llm/skills/page-actions/SKILL.md` | 当前页面的填写和保存。右下角对话按需读取。改表单步骤、字段取值和是否保存，改这一份。 |
| `llm/skills/measure-*/SKILL.md` | 计量里交给模型的一步一份。识别产品、标准字段映射、分类字段映射、抽取、选表、确认数据、补权重条件、分类流程、公式字段映射。调用时读取正文，不放进 `DIALOGUE`。识别产品对应工具 `identify_products`，标准字段映射对应工具 `map_fields`。底稿页选表是 `measure-sheets-paper`，流水线选表是 `measure-sheets`。 |
| `llm/skills/decision-tree/SKILL.md` | 决策树助手。只在暴露分类页那一次模型调用里作为系统提示。 |
| `llm/skills/credit-weight/SKILL.md` | 权重法判定。weight 子智能体按需读取：前置检查、调用 `run_weight_decision`、只转述结果、禁止重算。 |
| `llm/skills/hqla-review/SKILL.md` | HQLA 七步、第 5 步参考库匹配口径、摘要工具和禁止事项。 |
| `llm/skills/market-risk/SKILL.md` | 市场风险模块、公式、资本比例和结果对比的边界。 |
| `llm/skills/reference-data/SKILL.md` | `hqla_reference` 的来源、匹配键、手工补录和 stale 口径。 |
| `llm/skills/working-paper/SKILL.md` | 底稿缓存的字段和只读口径，明确不要调用 `load_or_compute()`。 |
| `llm/skills/rule-learn/SKILL.md` | 从规则 Excel 学规则。对应 `llm/capabilities/rule_learn.py`。 |
| `llm/skills/rule-chat/SKILL.md` | 知识库没命中时的兜底回答。对应 `llm/capabilities/rule_chat.py` 的 `answer`。 |
| `llm/skills/rule-basis/SKILL.md` | 知识库没有原文时的规则依据概括。对应 `rule_chat.basis`。 |

## 计算

| 路径 | 作用 |
| --- | --- |
| `core/pipeline/registry.py` | 唯一的步骤注册表：`ENABLED` 决定哪些步骤真的执行，`steps()` 按监管顺序返回 `StepSpec`。当前只有 `weight`。 |
| `core/pipeline/pipeline.py` | `run_pipeline` 和 `pipeline_steps`。`STEPS` 是 `registry.ENABLED` 的兼容别名。 |
| `core/pipeline/state.py` | 步骤之间传递的状态：工作簿路径、已跑步骤、停住原因、留痕和金额。 |
| `core/pipeline/nodes.py` | 每个节点调用对应步骤的 `program.run`。 |
| `core/pipeline/workflow.py` | 按 `registry.steps()` 建节点和下一跳。下一步没启用，或本步已经停住，就结束。 |
| `subagents/__init__.py` | `ORDER`。顺序是 weight、ccf、crm、rwa，不能调换；是否执行看 `registry.ENABLED`。 |
| `llm/agents/subagents.py` | 四个 DeepAgents `SubAgent` 规格：名字、说明、系统提示、工具。weight 带 `run_weight_decision`，其余只带状态工具。 |

## 决策树

| 路径 | 作用 |
| --- | --- |
| `tree/edit.py` | 决策树助手。提示词在 `skills/decision-tree/SKILL.md`。先判断修改或新增。修改先说明当前规则。新增按监管条款，从通用分类扩展。用户说全部或按条款库时，先出一版草稿，再由用户调整。不写文件。用户确认并选择保存后，由 Koa 写入。 |

## 流水线

在仓库根目录执行 `python -m agent.core.pipeline.pipeline 工作簿.xlsx`。按 `ORDER` 走，只执行 `STEPS` 里的步骤。名单里没有的步骤不会执行，也不会编结果。

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
| `prompts/agents/weight/AGENTS.md` | 这一步的说明和提示词。 |
| `tools/steps.py` | 工具 `run_weight_decision`、`ccf_status`、`crm_status`、`rwa_status`。 |
| `weight/program.py` | `run(context)`。把工作簿交给 `calc/engine.run_workbook`，把结果路径、留痕、敞口和风险加权资产放回 context。 |
| `weight/calc/engine.py` | 逐笔分类、权重和敞口。 |
| `core/weight/rules.py` | 把分类 JSON 收成决策树。 |
| `core/weight/exposure.py` | 分类执行器：按顺序走规则树、归一化取值。工作簿计算还会用到多重评级和同一银行权重回写；向导第五步只用规则树和取值归一化。 |
| `weight/classify.py` | 向导第五步：按第二步的债项、第三步的产品、第四步确认的映射，从数据库取产品规则逐笔分类，并在 `output/traces/step5/` 每笔写一份 Markdown。不做债务人汇总、多重评级和同一银行权重回写。 |
| `weight/calc/calc_trace.py` | 写计算留痕。文件在仓库根目录 `output/traces/`。 |
| `llm/capabilities/field_mapping.py` | 用模型把表头对到分类字段。 |
| `weight/calc/paths.py` | `ROOT` 指向 `weight/`，用来找分类 JSON。密钥在仓库根目录 `.env`。`OUTPUT` 指向仓库根目录 `output/`。 |
| `weight/knowledge/` | 分类规则。计算读 `权重法风险暴露分类.json`。写法见同目录 `风险暴露分类配置说明.md`。 |
| `weight/samples/` | 试算底稿。 |

### weight/paper

底稿页用的权重计算。Flask 的底稿接口读这里。缓存是同目录 `底稿模型计算.json`。

| 路径 | 作用 |
| --- | --- |
| `paper/engine.py` | 把底稿明细对到分类字段，再按决策树计算。 |
| `paper/working_paper.py` | 从信用风险底稿读出已经算好的风险加权资产。 |
| `paper/calc_trace.py` | 把这次底稿计算写成 `output/traces/`。 |
| `paper/clarify.py` | 底稿里拿不准的列，交给模型提问。 |
| `paper/exp_flow_gen.py` | 按产品字段生成分类流程，并标出缺的字段。 |

### ccf 和 crm

说明在 `prompts/agents/ccf/AGENTS.md` 和 `prompts/agents/crm/AGENTS.md`。程序各有 `__init__.py`、`program.py`。问到就停住。不要在这里补系数或拆分。

### rwa

`program.py` 按留痕汇总。这一步还没进 `STEPS`，`run` 停住。

`rwa/market/` 是回购和市场风险的公式计算，给 Flask 的上传和对比接口用。

| 路径 | 作用 |
| --- | --- |
| `core/market/calculator.py` | 选定公式包并计算。 |
| `core/market/formulas.py` | 正回购、外汇互换、回购利率、利率互换、外汇净敞口。 |
| `core/market/fields.py` | 公式用的字段和表头别名。 |
| `core/market/reference.py` | 公式里的参照表。 |
| `core/market/rule_calc.py` | 按已写好的规则和映射列计算。 |
| `llm/capabilities/market_mapping.py` | 把上传表头对到公式字段。 |
| `core/market/weight_tables.py` | 从上传工作簿收集到的权重。 |
| `core/market/compare.py` | 把计算结果收成监管报表并对比。 |

## 一步里有什么

weight、ccf、crm、rwa 是计算步骤。页面对话不会按它们再起一个模型。总控只看见 `tools/` 里的工具；流水线调用的是各步的 `program.run`。

`prompts/agents/<名字>/AGENTS.md` 开头写 `description`，正文是这一步的说明。`llm/agents/subagents.py` 通过 `subagent_prompt` 读这份文件。

工具在 `agent/tools/steps.py`；DeepAgents 的 `SubAgent` 规格在 `llm/agents/subagents.py`。说明从这份文件读，不要再写死在 Python 里。

`program.py` 给流水线调用：

- `NAME`、`DETAIL`
- `status()`：给 `pipeline_steps` 用的一行说明
- `explain()`：这一步被单独问到时的原文。还没实现就明确停住
- `run(context) -> context`：真正计算。缺字段就设 `context["stopped"] = True` 和 `context["stop_reason"]`，不要补一个数

`context` 至少有 `source`（工作簿路径）。返回时保留 `annotated`、`trace_file`、`ead_yi`、`rwa_yi`。后两个单位是亿元。

## 写计算步骤时以哪个文件为准

`ENABLED` 只看 `agent/core/pipeline/registry.py`。没有列进去的步骤名，就还不能执行。`pipeline.STEPS` 只是它的兼容别名。不要在对话、工具或前端里补一个系数或金额。

分类条件和权重只改 `subagents/weight/knowledge/权重法风险暴露分类.json` 里用户点名的规则。`when` 的 `field` 和 `match` 用该文件 `options` 里已有的 `code`。空单元格保持不命中，不要为了算完填一个权重。

这一步的说明和提示写在 `agent/llm/prompts/agents/<名字>/AGENTS.md`。工具统一放 `agent/tools/steps.py`；DeepAgents 的 `SubAgent` 规格在 `llm/agents/subagents.py`，通过 `agent/llm/prompts/layout.py` 的 `subagent_prompt` 读取这份文件。

`run(context)` 缺路径或缺少必要字段时，设置 `stopped` 和 `stop_reason` 后返回。不要估算敞口或风险加权资产。`ead_yi` 和 `rwa_yi` 只从 `run_workbook` 的返回值抄过来。流水线这一步的 `run_workbook` 在 `weight/calc/engine.py`。

## 加一步

1. 新建 `subagents/<名字>/`，放入 `program.py` 和 `__init__.py`。在 `prompts/agents/<名字>/AGENTS.md` 写说明和提示词。
2. 把这一步加进 `subagents/__init__.py` 的 `ORDER`，位置按监管计算顺序。
3. 在 `llm/agents/subagents.py` 的 `build_subagents()` 里加一份 `SubAgent` 规格，工具和技能按需给。
4. 在总控 `llm/prompts/system_prompt.md` 里写明什么问题交给它。
5. `program.run` 能用真实输入跑通之后，才把名字追加到 `agent/core/pipeline/registry.py` 的 `ENABLED`。没跑通不要写进名单。
6. 改完 Python 执行 `pm2 restart rwa-agent`。对话流程在第一次回答时建好并缓存，不重启仍是旧的。
