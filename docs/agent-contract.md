# Agent 外部契约（重构基线）

本文件只记录**外部可见**的约定。`agent/` 内部可以重构，下面这些不能被改坏。
阶段 0 的测试 `tests/agent/test_contract.py` 锁住了其中可测的部分。

## 1. 进程与端口

| 进程 | 入口 | 端口 |
| --- | --- | --- |
| Vite | `client/` | 5173 |
| Koa | `server/src/index.js` | 8780 |
| Flask | `app.py` | 8766 |

浏览器只经过 Koa。Koa 对 `/api/agent/chat`、`/api/rules/chat` 原样转发到 Flask；
`/api/exposure-tree/propose` 会先补文档再转发。Koa 不实现智能体。

## 2. `POST /api/agent/chat`

请求：

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "page": "/hqla",
  "config": {"...": "可选，EAD 配置"},
  "threadId": "可选，上一轮返回的线程号",
  "confirm": "可选，true / false；只在上一次停在确认时有意义",
  "catalog": {"pages": [], "apis": [], "forms": [], "scope": {}}
}
```

响应（始终是一个 JSON，不是 SSE）：

```json
{
  "reply": "给用户看的纯文本，最多 4000 字",
  "pages": [],
  "draft": "可选，只在带 config 时出现",
  "actions": [{"path": "/hqla", "form": "task", "fields": {}, "save": true}],
  "threadId": "线程号，下一轮原样送回",
  "confirm": false
}
```

不变量：

- `pages` 恒为空数组。
- `confirm=true` 时 `actions`、`draft` 都为空，前端只显示确认 / 取消。
- 停在确认时，回复文本固定包含「确认后才会开始计算」。
- 同一 `threadId` 只追加最新一条用户消息；检查点保留最近 16 条。
- 进入模型前只保留最近 8 条、每条 800 字。
- 不允许把工具名、字段编码、技能名写进 `reply`。

## 3. `POST /api/rules/chat`

请求 `{"messages": [...]}`；响应 `{"reply": "...", "updates": null}`。
它问的是微信知识库，不经过计算流水线。

## 4. `POST /api/exposure-tree/propose`

请求由 Koa 组装：`{messages, label, document, generic, clauses}`。
响应是决策树助手 JSON：`{action: "explain"|"ask"|"draft", reply, changes?, document?}`。
`agent/tree/edit.py` 只起草，不写文件。

## 5. HQLA 与底稿

`/api/hqla/list-meta|inspect|parse|compute|sample|list-hits|export` 的请求 / 响应由
`agent/subagents/hqla/service.py` 定义；`hqla/` 是纯函数库，不调用模型。
`/api/working-paper` 只读 `agent/subagents/weight/paper/底稿模型计算.json`，不重算。

## 6. MCP

`python -m agent.mcp` 的 `tools/list` 必须与 `agent/tools/__init__.py` 的 `tools` 一致。
当前工具：`pipeline_steps`、`run_weight_decision`、`recent_calculation`、
`ccf_status`、`crm_status`、`rwa_status`、`page_actions`、
`identify_products`、`map_fields`、`working_paper_summary`、
`hqla_compute_summary`、`hqla_sample_plan`、`market_modules`、
`exposure_class_summary`。

## 7. 计算顺序

- `registry.ENABLED` 决定哪些步骤真的执行，当前只有 `weight`；`pipeline.STEPS` 是兼容别名。
- `ORDER`（weight、ccf、crm、rwa）是监管顺序，只用于展示和组装；`registry.steps()` 把它和 `ENABLED` 合成一份。
- `ccf`、`crm`、`rwa` 的 `program.run` 停住并写 `stop_reason`，不得补数。
- `weight` 的 `ead_yi` / `rwa_yi` 只能抄 `run_workbook` 的返回值。

## 8. 模型

| 用途 | 模型名来源 | 默认 |
| --- | --- | --- |
| 对话、决策树 | `agent/agent.json` 的 `runtime.model` | `qwen-plus` |
| 表头 / 字段映射 | 环境变量 `MODEL_NAME` | `qwen-plus` |

密钥：`DASHSCOPE_API_KEY`，其次 `MODEL_API_KEY`。
地址：`MODEL_BASE_URL`，默认 DashScope 兼容接口。`temperature=0`。

## 9. 运行产物

- 检查点与存储：`output/runtime/checkpoints.sqlite`、`output/runtime/store.sqlite`
- 留痕：`output/traces/<名>-计算留痕.json|md`
- 结果工作簿：`output/workbooks/<名>_风险暴露分类.xlsx`
- `output/` 不提交。

## 10. 验证

```bash
.venv/bin/python -m pytest tests/agent -q
pm2 restart rwa-agent
```

改过任何 Python 后必须重启 `rwa-agent`：`platform/graph.py` 的图在首次调用时构建。
`RWA_CHAT_ENGINE=legacy` 可回到旧的 `llm_call` / `tool_node` 循环；默认是 DeepAgents。
