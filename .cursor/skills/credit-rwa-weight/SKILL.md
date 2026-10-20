---
name: credit-rwa-weight
description: >-
  按《商业银行资本管理办法》权重法做风险暴露权重决策，并计算敞口和风险加权资产。在用户提到风险暴露权重、权重法、计算留痕、风险暴露分类.xlsx，或修改交付/exposure-weight-decision、权重法风险暴露分类.json、paper_calc、calc_trace、exposure_class 时使用。
---

# 风险暴露权重决策

程序目录是 `交付/exposure-weight-decision`。下面的命令都在这个目录执行。分类和权重只读这里的 `knowledge/权重法风险暴露分类.json`。

`archive/` 里的 `rwa_agent/`、`web/`、`knowledge/风险暴露分类.json`、`knowledge/底稿模型计算.json` 是另一套。不要改那一套来影响这次结果，也不要把那份缓存当成这次的输出。

对照提示词、计算顺序、决策树或留痕时，打开下面其中一个文件，再改 Python。提示词以 Python 函数里的字符串为准；改了字符串，同步改对应的 md。

- [references/prompts.md](references/prompts.md)：三次通义调用的系统提示、用户 JSON，以及返回值怎么被采纳
- [references/paper-calc.md](references/paper-calc.md)：从工作簿到逐笔结果的计算顺序
- [references/exposure-class.md](references/exposure-class.md)：分类 JSON 怎么变成树，条件怎么比较，权重怎么取
- [references/calc-trace.md](references/calc-trace.md)：留痕步骤，以及 JSON、Markdown、Excel 各写什么

## 输入要求

必须有用户给出的信用风险底稿，扩展名是 `.xlsx`。路径不存在就停下来，向用户要文件。不要换成别的工作簿，也不要用 `造覆盖数据.py` 生成的表充数。

可以另给结果 Excel 的路径。不给则写到与底稿同一目录，文件名是 `工作簿名_风险暴露分类.xlsx`。

运行环境：

- Python 3.10 及以上。
- 依赖只有 `openpyxl`，列在本目录 `requirements.txt`。
- 本目录 `.env` 里有非空的 `DASHSCOPE_API_KEY`。只检查是否存在，不要打印，也不要写进回复、日志或本技能。没有就停，让用户自己写入 `.env`，不要让用户把密钥贴到对话里。

规则文件不是每次计算都要用户交的输入。只有用户要求改分类或权重时才编辑它。

## 操作步骤

先判断用户要哪一件，只做那一件。

### 计算一本工作簿

1. 确认底稿文件存在，并且当前目录是 `交付/exposure-weight-decision`。
2. 确认 `.env` 里有非空的 `DASHSCOPE_API_KEY`，不要输出它的值。
3. 还没装依赖时执行 `python3 -m pip install -r requirements.txt`。
4. 执行：

```bash
python -m rwa_agent.paper_calc 工作簿.xlsx
```

第二个参数是结果 Excel 路径，可以省略。

5. 成功时标准输出正好三行：结果 Excel 路径、留痕 JSON 路径、`敞口 … 亿  风险加权资产 … 亿`。回复只用这三行里的路径和数字。失败则说明错误原文，不要编一个敞口或权重。
6. 用户要解释某一笔时，打开同名的 `data/traces/工作簿名-计算留痕.md`，按源表名和 Excel 行号找到那一节。只引用该节写出的取值、命中规则、公式和代入。用规则名回到 `knowledge/权重法风险暴露分类.json` 里 `name` 相同的那一条。留痕没写的分支不要补。

用户要按流水线顺序算整本书时，不要在这里改命令。使用技能 `credit-rwa-pipeline`，执行 `python -m rwa_agent.pipeline 工作簿.xlsx`。这一步在 `STEPS` 里的名字是 `weight`，实现是 `rwa_agent/steps/weight.py`，内部仍调用 `run_workbook`。

### 改规则

1. 先读 [references/exposure-class.md](references/exposure-class.md)。字段和规则的完整写法再看 `archive/knowledge/风险暴露分类配置说明.md`。
2. 分类瀑布只改 `交付/exposure-weight-decision/knowledge/权重法风险暴露分类.json` 的 `rules`。`when` 的 `field` 和 `match` 写 `options[].code`，不写中文标签，不写 Excel 表头。末端用数字 `value`（`1` 是 100%）或 `weight.same_as`。字段对不上或单元格为空时条件不命中，不要为了算完补一个权重。
3. 多重评级、同业未评级、缓释都写在 `rules` 里。同业未评级是商业银行的前两个 `children`。多重评级和缓释是 `rules` 里的节点，不写会挡住其他类别的 `when`。权重这一步不拆本金，也不改原风险权重。
4. 用同一本工作簿再跑一遍「计算一本工作簿」。对照新留痕里的规则名和代入式。不要改留痕或缓存来修正结果。

### 检查每个末端能不能走到

只有用户明确要求覆盖决策树每个末端时，才在该目录执行 `python 造覆盖数据.py`。它按每个末端造一行，写出 `同业_模拟.xlsx`。再用这本书跑「计算一本工作簿」，看留痕是否进了对应规则。这本书不代替正式底稿。

## 输出格式

回复用户时用这个结构。数字只来自本次命令输出或留痕，不要自己再算一遍。

```text
结果：<标准输出第一行的 Excel 路径>
留痕：<标准输出第二行的 JSON 路径>（说明在同名 .md）
敞口：<命令行数字> 亿元
风险加权资产：<命令行数字> 亿元
```

结果 Excel 是源工作簿的副本。各表写什么、留痕 JSON 和 Markdown 的字段，见 [references/calc-trace.md](references/calc-trace.md)。敞口和风险加权资产不写进明细列。

用户要解释某一笔时，在上面的汇总之后另写一小节，只包含：源表、行号、风险暴露、权重、命中的规则名、公式、代入。

## 注意事项

- 不要编造权重、条款号，或底稿里没有的金额。
- 金额沿用底稿口径。命令行的敞口和风险加权资产单位是亿元。留痕里的 `ead`、`rwa` 与源表金额列同一单位。
- 通义千问只做选表、表头对应、规则停住后补条件。提示词和采纳规则在 [references/prompts.md](references/prompts.md)。不要在对话里另写一套提示词去算权重。
- 命令行 `paper_calc` 不读 `knowledge/底稿模型计算.json`。不要手改这份缓存或 `data/traces/` 里的留痕来改结果。
