# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 写代码前先读 AGENTS.md

根目录 `AGENTS.md` 是这个仓库的代码生成契约（Cursor 通过 `.cursor/skills/rwa-codegen/` 走同一套）。它比本文件严格，冲突时以它为准。核心几条：

- **只写打开过的名字。** 字段、路由、表列、权重、条款号、金额，都要能在本轮打开过的源文件里指到。缺了就停下来写出缺的名字，不要编一个看起来合理的填上。
- **分层，一层只改一层。** 页面/菜单 → `client/README.md`；接口/库表 → `server/README.md`（列名以 `sql/001_schema.sql` 为准）；权重/转换系数/缓释/汇总 → `agent/README.md`；规则包 → `knowledge/README.md`。跨层时顺序固定：库表 → 接口 → 前端 API → 页面和菜单。计算步骤不走这四步，按 `agent/README.md` 单独加目录。
- **不要在前端或 Koa 里另写一套权重。** 计算只发生在 `agent/`。

用户只说一句需求片段，自己对上现有的页面、接口和库表，不要让用户补菜单名或表名。

## 常用命令

首次安装（Python 智能体 + 两个 Node 服务）：

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                      # 填 DASHSCOPE_API_KEY
npm install -g pm2

cd client && npm install
cd ../server && npm install && cp .env.example .env   # 填 MySQL 密码
```

数据库（先建表，再灌数据）：

```bash
mysql -u root -p < sql/001_schema.sql
mysql -u root -p < sql/002_seed.sql
```

日常运行：

```bash
./start.sh                    # pm2 拉起 rwa-agent(8766) 和 rwa-api(8780)
cd client && npm run dev      # 前端 http://127.0.0.1:5173
pm2 logs rwa-agent
pm2 restart rwa-agent         # 改过任何 Python 后必须执行
```

`pm2 restart rwa-agent` 是硬性的：`agent/platform/graph.py` 的图在首次调用时构建，不重启就还是旧的。

其它：

```bash
python -m agent.calculation.pipeline 工作簿.xlsx [结果.xlsx]   # 整表计算，在仓库根目录执行
node tools/build-seed.mjs                          # 重新生成 sql/002_seed.sql（别手改大段 002_seed.sql）
```

没有测试框架，也没有 lint 脚本。`client` 和 `server` 的 `package.json` 里只有 `dev`/`start`/`build`。

## 三个进程和请求怎么走

| 进程 | 入口 | 端口 | 作用 |
| --- | --- | --- | --- |
| Vite | `client/` | 5173 | 前端开发服务，把 `/api` 代理到 8780 |
| Koa | `server/src/index.js` | 8780 | 全部 `/api/*` 接口，读 MySQL |
| Flask | `app.py` | 8766 | 智能体对话、底稿/规则库接口、上传与对比 |

浏览器的两条路径：

- 页面按钮 → `POST /api/...` → Vite 代理 → Koa → MySQL 或读文件。
- 右下角 AI → `POST /api/agent/chat` → Koa **原样转发**到 `http://127.0.0.1:8766` → Flask 调 `agent.platform.graph.reply`。规则助手是另一条：`POST /api/rules/chat`，问的是微信知识库，不是计算子智能体。Koa 侧不实现智能体（见 `server/src/index.js` 的两个转发路由）。

## 四层结构

- `client/` — Vue 3 + Vue Router + Vuex + axios。`src/router/index.js` 的路由和 `src/utils/nav.js` 的菜单必须一致；`meta.sections`/`PARENT` 表达「页内页签不是新菜单项」。所有页面包在 `App.vue` 里。新页面以 `src/view/rule/ClausesView.vue` 为模板（`useContext()`、`AsyncView`、`panel`、`tbl`）。页面只从 `src/api/*.js` 要数据，不在 `.vue` 里直接写 `axios`/`fetch`。
- `server/` — Koa 2，前缀 `/api`。库列是下划线，给页面的键是驼峰，**转换只发生在路由函数里**（参考 `GET /products` 的映射）。日期用文件顶部的 `date()`，JSON 列用 `json()`，查询一律 `query(sql, [占位值])`，不要拼接 SQL、不要新建连接池。计算权重/跑工作簿/派子智能体都不在这里。
- `agent/` — deepagents 计算智能体。见下节。
- `knowledge/` — 规则库。`local/` 是仓库里的规则包（Markdown + `library.py`），`weknora/` 是微信知识库对话。注意：**信用风险的分类 JSON 不在 `knowledge/`**，在 `agent/subagents/weight/knowledge/`。

密钥只有两处，都在 `.env` 里，且都不提交：仓库根目录 `.env` 放 `DASHSCOPE_API_KEY`、`WEKNORA_*`；`server/.env` 放 MySQL 变量。

## 智能体：总控 + 流水线

这几块不能混：

- **平台**（`agent/platform/`）：接收页面的话，调用 `agent/model.py`，按模型点名执行 `agent/tools/`，不自己算数，也不负责打开页面。底稿计算、计量向导、结果明细在左侧菜单。`graph.py` 把调用模型和执行工具接成循环。
- **计算**（`agent/calculation/` 和 `agent/subagents/<步>/`）：信用风险按监管顺序计算。`calculation/graph.py` 把每一步做成节点，只进入 `STEPS` 里的名字。
- **决策树**（`agent/tree/`）：暴露分类页起草修改，不进对话图。
- **底稿页 / 市场风险**（`weight/paper/`、`rwa/market/`）：给 Flask 的接口用，**不进流水线名单**。

两个顺序概念必须分清：

- `agent/calculation/pipeline.py` 的 `STEPS` 决定**哪些步骤真的会执行**。当前只有 `["weight"]`。
- `agent/subagents/__init__.py` 的 `ORDER`（`weight, ccf, crm, rwa`）是**监管计算顺序**，只用于展示和组装子智能体，不能调换。

`ccf`、`crm`、`rwa` 已经建了目录和提示，但 `program.run` 直接设 `stopped`/`stop_reason` 停住。**只有当某步的 `program.run` 能用真实输入跑通后，才把它的名字追加进 `STEPS`。** 在它进名单之前，不要在对话、工具或前端里补一个系数或金额让流水线继续。

`weight` 是唯一实现了的步骤：`program.run(context)` 把工作簿交给 `calc/paper_calc.py:run_workbook`，把 `annotated`、`trace_file`、`ead_yi`、`rwa_yi` 放回 context（后两个单位是亿元，只从 `run_workbook` 的返回值抄）。留痕写仓库根目录 `output/traces/`，结果工作簿写 `output/workbooks/`（底稿不在权重目录里时写在底稿旁边）。

`context` 至少含 `source`（工作簿路径）。缺路径或必需字段时设 `stopped`/`stop_reason` 后返回，不要估算敞口或 RWA。

### 提示词在文件里，不在代码里

子智能体的说明和提示词写在 `agent/.deepagents/agents/<名字>/AGENTS.md`；`__init__.py` 只放工具函数和 `spec()`，通过 `agent/platform/layout.py` 的 `subagent_prompt` 读取这份文件。**不要把提示词写回 Python 字符串。** 加一步的完整步骤见 `agent/README.md` 的「加一步」。

### 单一数据源

分类规则和试算底稿只有一份，被智能体和 Koa 同时读：

- `agent/subagents/weight/knowledge/权重法风险暴露分类.json` — 权重法分类。改只改用户点名的那一条，`when` 的 `field`/`match` 用该文件 `options` 里已有的 `code`，空单元格保持不命中。`server/src/measure.js` 也读这份。
- `agent/subagents/weight/paper/底稿模型计算.json` — 底稿页缓存。`server/src/paper.js` 的 `GET /working-paper` 只读不算。
- `agent/subagents/weight/samples/` — 试算底稿。

`GET /measure` 的笔数和金额由 `server/src/measure.js` 算出，不要在路由或页面里另写一套合计。底稿页（`weight/paper/`）和整表计算（`weight/calc/`）是两套独立实现，别混用。

`output/` 被 gitignore，里面是每次计算的留痕和结果工作簿，不提交。演示业务数据是模拟数据。
