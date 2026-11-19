# 权重法 V3.3 规则集

由 `../权重法风险暴露分类.json` 整份迁移，数值、条件和规则顺序不变，只改语法和拆分方式。语法以 `docs/信用风险规则/` 下的《STC 风险暴露分类与风险权重规则配置语法说明书 V3.3》和 `stc-exposure-risk-weight-v3.3.schema.json` 为准。

| 文件 | rule_type | 作用 |
| --- | --- | --- |
| `STC_EXPOSURE_CLASSIFICATION.v1.0.0.json` | `exposure_classification` | 只输出 `exposure_class`。按原文件 17 个大类的顺序首条命中。 |
| `STC_RISK_WEIGHT.v1.0.0.json` | `risk_weight` | 只输出 `risk_weight`。以 `exposure_class` 为入口，沿用原大类下的评级、资本档次、贷款价值比等细分。 |
| `辅助计算规则.json` | — | V3.3 不覆盖的构件，供执行引擎和编排程序使用，不要按规则集加载。 |

两个规则集按「先分类、再定权重」执行：分类结果作为 `exposure_class` 输入权重规则集。

## 和原文件的对应关系

| 原写法 | 迁移后 |
| --- | --- |
| 顶层 `name` / `title` | 拆成两个规则集各自的 `name` / `title`，原值留在 `note` |
| 节点 `name` | `id`，原值不变，留痕里的规则名仍能对上 |
| 顶层 17 个大类 | 分类规则集 17 条规则；大类名就是 `exposure_class` 的 code，未命中为 `unclassified` |
| 大类下的细分节点 | 全部进入权重规则集，挂在对应 `exposure_class` 下 |
| `value`（比值） | `result.risk_weight`（百分数）。`0.1` 写 `10`，`2.5` 写 `250` |
| `weight.same_as: counterparty_ordinary_claim` | `result.risk_weight: "$input.counterparty_ordinary_claim_rw"`，由编排程序先按普通债权算好写入 |
| `weight.greater_of: [0.9, same_as]` | 同上，再加一条 `floor` 调整（`operation: "floor"`, `value: 90`） |
| `weight.greater_of: [1, {field: derived_bank_weight}]` | 引用 `$input.derived_bank_weight`，再加 `floor` 100 |
| `bank_peer_weight` 的比值阈值 | 改百分数阈值（`1.5` → `150`，`[0.5, 1]` → `[50, 100]`），字段 `unit` 为 `PERCENT` |
| 节点内联 `fields` | 定义提升到顶层 `fields`；节点上只保留字段名数组 |
| 节点的条件式 `skip`（`fi_bank_applicable` 为不适用时整段跳过） | V3.3 的 `skip` 只能是布尔常量，改成 `when` 里加 `not` 条件；字段 `missing_policy: "default"`，没填视为 `applicable`。分类规则集里对商业银行的规则整条不成立，继续看后面的房地产等类别，不落入 `fi_other` |
| 顶层 `otherwise`（未归类） | 分类规则集 `otherwise` 输出 `unclassified`；权重规则集 `otherwise` 输出 `risk_weight: null` 并标 `MANUAL_REVIEW` |
| 节点 `otherwise` | 原样保留为 V3.3 节点级 `otherwise`。有子节点但原来没有兜底的分支，补一条 `MANUAL_REVIEW` 结果，等价于原来的「权重未单列」 |

## 没有进入两个规则集的内容

| 原内容 | 去向 | 原因 |
| --- | --- | --- |
| `multiple_assessments`（多重评级取值） | `辅助计算规则.json` | V3.3 只判断分类和权重，不定义评级聚合 |
| `crm_split`（缓释拆分、0% 豁免、货币错配折扣） | `辅助计算规则.json` | 属于敞口金额和缓释，V3.3 明确不覆盖 |
| `extensions` / `excel`（扩展示例、Excel 映射示例） | `辅助计算规则.json` | 是编写辅助，不是规则；原文件里也标了「可删除」 |
| 参数表 `T_STC_*` | 未引入 | `docs/信用风险规则/parameters/` 是香港 STC 的数值，不能拿来套内地权重法。当前所有数值风险权重按 V3.3 §10.6.3 直接写在 `result.risk_weight`。以后要把数值抽到 `T_*` 表，需要先定表结构、键和仓库位置，再改 `parameter_lookup` |

## 数值口径

- `risk_weight`、`bank_peer_weight`、`derived_bank_weight`、`counterparty_ordinary_claim_rw` 用百分数（`10` 表示 10%）。
- `ltv`、`covered_oc_ratio`、`cet1_ratio`、`leverage_ratio`、`exposure_share`、`debt_ratio`、`provision_ratio` 仍是比值（`0.5` 表示 50%），门槛值未改。
- `single_exposure`、`revenue_last_year` 保持原值（元），但 `unit` 只写了 `CURRENCY`，没有写具体币种；原文件没有约定币种，不要在这里补。

字段缺失统一按 `missing_policy: "not_applicable"` 处理，即条件不成立、继续往下走，和原引擎「空单元格不命中」一致。`fi_bank_applicable` 例外：缺失按 `applicable` 处理（`missing_policy: "default"`）。

## 还没改的读取方

新文件目前只是配置，运行时仍读旧文件。切换到 V3.3 需要一起改：

- `agent/core/weight/rules.py`、`agent/core/weight/exposure.py`、`agent/core/weight/engine.py`
- `app.py` 的底稿/分类接口（第 303 行附近）
- `tools/build-seed.mjs`（把整份 JSON 写进 `sql/002_seed.sql`）
- `server/src/measure.js` 及前端分类/权重配置页
- `server/lib/engine.cjs`（Koa 侧另一份规则解释器）

顺序按仓库约定：库表 → 接口 → 前端 API → 页面。

## 校验

```bash
python3 - <<'PY'
import json, jsonschema
schema = json.load(open("docs/信用风险规则/stc-exposure-risk-weight-v3.3.schema.json"))
for path in [
    "agent/steps/weight/knowledge/v33/STC_EXPOSURE_CLASSIFICATION.v1.0.0.json",
    "agent/steps/weight/knowledge/v33/STC_RISK_WEIGHT.v1.0.0.json",
]:
    errors = list(jsonschema.Draft202012Validator(schema).iter_errors(json.load(open(path))))
    print(path, len(errors))
PY
```

两份规则集当前都是 0 个 Schema 错误。字段引用、节点 ID 唯一性、`when`/`adjustments` 的条件字段和 `$input.` 引用均已检查，没有指向未定义字段。
