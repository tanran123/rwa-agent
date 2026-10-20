# 信用风险 RWA

当前产品分四块：

- `client/`：Vue 前端
- `server/`：Koa 接口，读 MySQL
- `sql/`：库表。先执行 `001_schema.sql`，再执行 `002_seed.sql`
- `agent/`：风险暴露权重智能体。计算包在 `交付/exposure-weight-decision`，由 `app.py` 在 8766 提供 `/api/agent/chat`

`archive/` 放以前的页面原型、市场风险规则包、底稿缓存和样例工作簿。页面样式、模拟债项和规则对话仍会读这里面的文件。

## 运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

cd client && npm install && npm run dev
cd server && npm install && npm start
.venv/bin/python app.py
```

前端开发地址默认 http://127.0.0.1:5173 ，接口 http://127.0.0.1:8780 ，智能体 http://127.0.0.1:8766 。

数据库连接写在 `server/.env`：`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE`。模型密钥写在仓库根目录 `.env` 的 `DASHSCOPE_API_KEY`。这两份文件不要提交。
