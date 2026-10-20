# 信用风险 RWA

生成代码之前先读 `AGENTS.md`。它约定编程助手怎么和下面这些说明协作：先读本文件判断功能属于前端、后端还是智能体，再打开对应目录里的 `README.md`，按清单落文件。不要把新产品功能写进 `archive/`。Cursor 会通过 `.cursor/skills/rwa-codegen/` 走同一套步骤。DeepSeek 或其他助手打开本仓库时，也从 `AGENTS.md` 开始。

加功能时直接说想要的效果，一两句就够。右下角的 AI 只做权重计算，不改页面和接口。

## 目录

| 路径 | 作用 |
| --- | --- |
| `client/` | Vue 前端。页面、菜单、调用接口。说明见 `client/README.md`。 |
| `server/` | Koa 接口，读 MySQL。说明见 `server/README.md`。 |
| `sql/` | 库表。`001_schema.sql` 建表，`002_seed.sql` 灌数。表的用途写在后端说明里。 |
| `agent/` | 风险暴露权重智能体。总控和四个计算子智能体。说明见 `agent/README.md`。 |
| `app.py` | Flask。只负责把 `/api/agent/chat`、`/api/rules/chat` 交给 Python。页面数据不写在这里。 |
| `交付/exposure-weight-decision/` | 权重法分类规则、试算底稿和计算入口。细分见下面「交付目录和计算结果」。 |
| `output/` | 每次计算写出的留痕和结果工作簿。不提交。 |
| `archive/` | 旧页面原型、市场风险规则包、底稿缓存、样例。前端样式和模拟债项仍会读这里。新功能不要加进来。 |
| `tools/build-seed.mjs` | 从主数据和分类 JSON 重新生成 `sql/002_seed.sql`。 |
| `ecosystem.config.cjs`、`start.sh` | 用 PM2 启动智能体和接口。 |

## 交付目录和计算结果

`交付/exposure-weight-decision/` 只放规则、试算底稿和计算入口。每次跑出来的文件写到仓库根目录 `output/`。更细的表在 `交付/exposure-weight-decision/README.md`。

| 放哪里 | 内容 |
| --- | --- |
| `交付/exposure-weight-decision/knowledge/` | 分类规则。计算读 `权重法风险暴露分类.json`。 |
| `交付/exposure-weight-decision/rwa_agent/` | 计算入口，转到 `agent/subagents/weight/`。 |
| `交付/exposure-weight-decision/samples/` | 试算底稿。 |
| `交付/exposure-weight-decision/.env` | 通义密钥。不提交。 |
| `output/traces/` | 计算留痕，JSON 和 Markdown。 |
| `output/workbooks/` | 交付目录里的底稿算完后的结果工作簿。 |

底稿放在交付目录以外时，结果工作簿写在那个文件旁边，文件名是 `工作簿名_风险暴露分类.xlsx`。留痕仍写到 `output/traces/`。

## 请求怎么走

页面按钮走接口：浏览器 `POST /api/...`，Vite 转到 `http://127.0.0.1:8780`，Koa 查 MySQL 或读文件。

右下角 AI 走智能体：页面 `POST /api/agent/chat`，Koa 转到 `http://127.0.0.1:8766/api/agent/chat`，Flask 调用 `agent.harness.reply`。规则助手是另一条：`POST /api/rules/chat`，问的是微信知识库，不是计算子智能体。

## 加功能时怎么说

用户只需要说效果，可以是一句片段，例如「条款也从右边弹出来」「EAD 要能新建，还能试算」。不必写菜单、接口或表名。

编程助手自己对上现有页面、接口和库表，再改代码。源文件里没有的字段、权重、条款号或金额，停下来写出缺的名字，不要编一个填上。

## 一个功能改哪里

说的是页面、菜单、筛选、表格：只改 `client/`。需要新数据时再加 `server/` 的路由；要落库时再改 `sql/`。

说的是列表、保存、导出、批次：改 `server/src/index.js`，查询放在现有模块或新建 `server/src/` 下的一个文件。前端在 `client/src/api/` 加对应函数。

说的是风险暴露权重、转换系数、缓释、风险加权资产汇总：改 `agent/subagents/` 里对应的那一步。分类规则只改 `交付/exposure-weight-decision/knowledge/权重法风险暴露分类.json`。不要在前端或接口里另写一套权重。

跨两层时按这个顺序生成文件：库表、接口、前端 API、页面和菜单。智能体步骤不经过这四步，按 `agent/README.md` 单独加目录。

## 不要做的事

不要编造权重、条款号或金额。空字段或对不上的字段保持不命中。`ccf`、`crm`、`rwa` 还没进计算名单时，不要补一个数让流水线继续。

密钥只放在仓库根目录 `.env` 的 `DASHSCOPE_API_KEY`，数据库密码只放在 `server/.env`。这两份文件不要提交，也不要写进回复。

## 运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
npm install -g pm2

cd client && npm install
cd ../server && npm install
cd .. && ./start.sh
cd client && npm run dev
```

`./start.sh` 拉起 `rwa-agent`（http://127.0.0.1:8766）和 `rwa-api`（http://127.0.0.1:8780）。前端开发地址默认 http://127.0.0.1:5173 。改了 Python 之后执行 `pm2 restart rwa-agent`。
