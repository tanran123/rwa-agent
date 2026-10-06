# 市场风险 RWA

澳门金管局口径下的信用风险和市场风险计算服务。上传明细工作簿后，先对应类型和表头，再按规则重算风险权重、RWA 和资本。

计算结果在本地按公式重算。通义千问只负责两件事：根据表头给出字段映射建议，以及在规则对话里说明或修改规则参数。写入规则库之前需要确认。

## 目录

- `app.py`：网页服务
- `rwa_agent/`：字段、公式、规则参数、表头建议、规则对话
- `knowledge/`：规则库的 Markdown。启动、打开页面和计算前都会重新读取
- `web/`：页面

## 运行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

浏览器打开 http://127.0.0.1:8766 。

密钥写在 `.env` 的 `DASHSCOPE_API_KEY`。启动时按这个顺序读取，已经有值的变量不会被后面的文件覆盖：

1. 上一级目录的 `.env`（本仓库的父目录）
2. 本目录的 `.env`（与 `app.py` 同级，由 `.env.example` 复制）

本目录还没有 `.env` 时，先执行上面的 `cp .env.example .env`，再把密钥写进去。填好之后，字段映射和规则对话才会调用模型。`QWEN_API_KEY` 也可以，会在 `DASHSCOPE_API_KEY` 为空时使用。
