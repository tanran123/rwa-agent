---
name: weknora-rule-chat
description: >-
  维护本仓库的微信知识库（WeKnora）与规则对话。在用户提到规则对话、规则库、知识库、
  WeKnora、微信知识库、上传文档，或修改 rwa_agent/weknora.py、rwa_agent/rule_chat.py、
  /api/rules/chat、/api/weknora 时使用。
---

# 微信知识库规则对话

规则对话只问微信知识库。通义千问仍只用于表头映射（`rwa_agent/mapper.py`）和 Excel 学规则（`rwa_agent/rule_learn.py`）。

## 调用

环境变量在 `.env`：`WEKNORA_BASE_URL`（默认 `https://weknora.weixin.qq.com/api/v1`）、`WEKNORA_API_KEY`。请求头是 `X-API-Key`。不要改成微信原子接口的 HMAC 签名。不要把密钥、AppSecret 写进回复、日志或技能文件。`.env` 已在 `.gitignore`。

| 用途 | 入口 |
| --- | --- |
| 规则对话，问全部知识库 | `chat_libraries(query)`，页面 `POST /api/rules/chat` |
| 添加规则时查监管依据 | `lookup_basis(title)`，页面 `POST /api/rules/basis`。用 `ask_libraries` 开独立会话，不占用规则对话的会话 |
| 指定一个库 | `ask(query, knowledge_base_id)`，`POST /api/weknora/ask` |
| 列出库 | `list_bases()`，`GET /api/weknora/bases` |

`chat_libraries` 复用进程内会话 `_rule_session`。会话失效时新建再问一次。进程重启后会话丢失。聊天接口是 SSE：累积 `response_type=answer` 的 `content`，引用在 `references`。

库的 id 以 `list_bases()` 为准，不要写死。当前库名是「网页笔记」和「微信转发」。

本地调用前先让进程加载 `.env`（导入 `app` 即可）。单独跑 `rwa_agent.weknora` 时，已有环境变量优先，未设置会报「未配置微信知识库 API Key」。

## 回答边界

`discuss_rules` 会在问题上追加：只根据知识库原文回答；没检索到就说明没找到；不要补充库外内容，也不要写「并非来自知识库」。

`_library_only` 按空行分段，遇到「并非来自知识库」「没有检索到」「一般金融知识」「基于一般」就停。前面没有正文时，固定回复 `知识库里没有找到相关内容。` 有引用且不是这句时，末尾加「依据：」和最多 4 个标题。

规则对话的 `updates` 保持 `None`。改规则参数走 Excel 学习或规则编辑，不从这条对话写回。

`lookup_basis` 同样只留知识库原文，取第一段，最长 500 字。知识库没找到时原句返回，不要补写公告号或行号。依据写在自建规则的 `basis` 上，计算模块不读它。

页面里助手气泡用 `renderMarkdown`。不要把回答改回纯文本转义。

## 改代码之后

服务在 `http://127.0.0.1:8766`，用 `.venv/bin/python app.py`，debug 关闭。改 Python 要先停掉监听再启动。退出码 143 是这次主动停进程，不是崩溃。`web/` 的 HTML、CSS、JS 刷新即生效。

验证用 `GET /health`、`node --check` 和接口请求。不要在回复里打印密钥。没有浏览器时说明没点过页面。

监管口径以 `knowledge/` 和已有解析结果为准。不要编造条文号或填报说明的行。
