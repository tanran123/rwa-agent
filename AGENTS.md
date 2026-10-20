# 写代码

这个文件给 Cursor、DeepSeek 和其他编程助手用。用户说要加功能时，按这里写代码。

`agent/` 是计算智能体，不负责改页面和接口。目录以 `agent/README.md` 为准。写代码的是当前这个编程助手。

用户加功能时往往只给一句片段。自己对上现有页面、接口和库表，按根目录 `README.md` 的「加功能时怎么说」做完。只有源文件里没有那个名字时才停下来问。

没有在本轮打开过的文件，就当作不存在。不要凭记忆补字段、路径、权重、条款号、金额或示例数据。缺了就停下来，写出打开过的文件和缺的名字，不要编一个看起来合理的名字填上。

## 协作

结构约定在五份说明里：根目录 `README.md`、`client/README.md`、`server/README.md`、`agent/README.md`、`knowledge/README.md`。先读说明，再打开要对齐的源文件，最后才改代码。说明里没有的目录不要新建。改了目录或清单，同时改对应的说明。

1. 读 `README.md`，判断功能属于前端、后端、计算智能体还是规则库。
2. 只打开要改的那一层，并按其中的清单落文件：
   - 页面、菜单、表格：`client/README.md`
   - 接口、库表：`server/README.md`，列名以 `sql/001_schema.sql` 为准
   - 权重、转换系数、缓释、汇总：`agent/README.md`
   - 本地规则包：`knowledge/local/`。微信知识库对话：`knowledge/weknora/`。清单在 `knowledge/README.md`。
3. 一层不够时按这个顺序：库表、接口、前端 API、页面和菜单。计算步骤不走这四步，按 `agent/README.md` 单独加目录。
4. 写每一处引用之前，打开被引用的文件，确认名字已经在里面。路由、函数、表列、组件属性和 CSS 类都要能在源文件里指到。
5. 做完后列出新建和修改的文件，并写明对应清单里的哪一条。拿不准的值不要写进代码，放在回复里说明源文件没有这一项。

## 什么必须从文件里抄

| 要写的内容 | 先打开 |
| --- | --- |
| 页面长什么样 | `client/src/view/rule/ClausesView.vue`。新页面沿用它的 `AsyncView`、`panel`、`tbl`。 |
| 菜单和路由 | `client/src/utils/nav.js`、`client/src/router/index.js`。路径必须两边一致。 |
| 当前客户、机构、地区、版本 | `client/src/store/index.js` 里的 `state`。页面用 `useContext().session`，不要再声明一份。 |
| 接口路径 | `server/src/index.js` 里已有的 `router.get` / `router.post` / `router.put`。前端 `client/src/api/*.js` 的路径必须和这里相同，且不要自己加 `/api` 前缀。 |
| 返回字段 | 同一个路由函数里的 `ctx.body`。页面只用这里出现过的键。库里有、响应里没有的列，页面不能直接读。 |
| 表和列 | `sql/001_schema.sql` 的 `CREATE TABLE`。SQL 只用这里的列名。新列先改这个文件。 |
| 加载和报错 | `client/src/components/AsyncView.vue`。属性只有 `load`。插槽给出 `data` 和 `reload`。 |
| 样式类名 | `client/src/assets/css/` 里已经出现的类。没有的类不要写进模板，除非同时在对应 css 里加上。 |
| 计算步骤名单 | `agent/pipeline.py` 的 `STEPS`。不要凭记忆写成还包含 `ccf`、`crm`、`rwa`。 |
| 分类规则和权重 | `agent/subagents/weight/knowledge/权重法风险暴露分类.json`。只改用户点名的那一条，不要顺手补权重。 |
| 本地规则包 | `knowledge/local/`。微信知识库对话在 `knowledge/weknora/`，不拿本地 Markdown 当回答。 |
| 试算底稿 | `agent/subagents/weight/samples/`。 |
| 计算留痕 | 仓库根目录 `output/traces/`。 |
| 结果工作簿 | 仓库根目录 `output/workbooks/`。底稿不在权重步骤目录里时，写在底稿旁边。 |
| 子智能体提示 | 该目录的 `agent.json` 和 `AGENTS.md`。不要把提示词写回 Python 字符串。 |
| 智能体返回 | `agent/harness.py` 的 `reply`。只有 `reply` 和 `pages`。`pages[].path` 只能是 `agent/pages.py` 里 `PAGES` 已有的键。 |

## 页面上下文里实际有的字段

`session` 来自 `client/src/store/index.js`：`ready`、`error`、`customers`、`jurisdictions`、`versions`、`orgs`、`customerId`、`orgId`、`jurisdiction`、`versionId`、`baseDate`。

`GET /bootstrap` 放进这些数组。客户行是 `id`、`name`、`code`、`category`、`note`。地区行是 `code`、`label`、`regulator`、`currency`、`currencyLabel`。机构行是 `id`、`name`、`jurisdiction`。版本行以 `server/src/index.js` 的 `version()` 为准。

## 接口形状

成功时响应体就是数据，axios 拦截器已经返回 `response.data`。失败时后端给 `{ "error": "原因" }`，前端拿到的是 `Error`，文案在 `err.message`。

数据库列是下划线，给页面的键是驼峰，转换只发生在 `server/src/index.js` 的路由函数里。查询用 `query(sql, params)`，条件用 `?` 占位。不要拼接 SQL，不要新建第二个数据库连接。

## 不能出现的写法

不要新增 npm 或 pip 依赖，除非用户明确要求，并且 `client/package.json` 或 `requirements.txt` 里本来就有这个包。

不要新建第二套 `axios`、路由或 Vuex。不要在 `.vue` 里直接写 `fetch` 或 `axios`。

不要在模板里写 `Promise`。模板里可以用的全局名字只有 `Math`、`Number`、`Date`、`Array`、`Object`、`Set`、`JSON`、`Map`。

不要编造权重、条款号、客户名、金额、字段编码或监管条文。演示数字只从已经打开的源文件或接口实现里引用。

不要在前端或 Koa 里另写一套权重。`ccf`、`crm`、`rwa` 的 `program.run` 还没实现时，不要把它们写进 `STEPS`，也不要补一个数让流水线继续。

密钥不要写进代码，也不要提交 `.env`。
