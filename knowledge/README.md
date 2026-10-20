# 规则库

这里分两块。信用风险的分类 JSON 在 `agent/subagents/weight/knowledge/`，不在本目录。

| 目录 | 是什么 |
| --- | --- |
| `local/` | 存在仓库里的规则包。计算和规则库页面读这些文件。 |
| `weknora/` | 微信知识库。页面 `POST /api/rules/chat` 把问题发到这里，不读 `local/` 里的 Markdown 当回答。 |

## local

`library.py` 按下面的顺序读 Markdown。`规则库.md` 是目录，服务启动时会重写。

| 路径 | 作用 |
| --- | --- |
| `library.py` | 读写规则包。 |
| `rules.py` | 规则包里的可改参数。 |
| `rule_graph.py` | 规则关系图，布局在 `graph.json`。 |
| `rule_learn.py` | 从 Excel 学规则，写回这些规则包。 |
| `repo_credit.md` | 正回购信用风险。 |
| `ccr_fx.md` | 外汇互换对手信用风险。 |
| `mr_repo.md` | 回购利率市场风险。 |
| `mr_irs.md` | 利率互换市场风险。 |
| `mr_fx.md` | 外汇净敞口市场风险。 |
| `权重表.md` | 从上传工作簿收集到的权重。数据在 `weights_observed.json`，由 `agent/subagents/rwa/market/weight_tables.py` 写入。 |

## weknora

密钥在仓库根目录 `.env` 的 `WEKNORA_API_KEY`。不要写进代码或回复。

| 路径 | 作用 |
| --- | --- |
| `weknora.py` | 调用微信知识库的接口。 |
| `rule_chat.py` | 规则对话，以及添加规则时查依据。知识库没有原文时，才改用通义补一句，并标明不是知识库原文。 |
