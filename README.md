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

`.env` 放在本目录即可。需要填写 `DASHSCOPE_API_KEY` 后，字段映射和规则对话才会调用模型。

## 上传到 GitHub

只上传这个 `rwa_service` 文件夹。不要上传上一级目录：那里有本机的 `.env` 和其他项目文件。客户明细工作簿也不要放进仓库，`.gitignore` 已忽略 `.env`、`.xlsx` 和 `.xlsm`。
