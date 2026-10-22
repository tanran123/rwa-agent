# 前端

Vue 3 + Vue Router + Vuex + axios。开发服务把 `/api` 代理到 `http://127.0.0.1:8780`。源码都在 `src/`，用 `@` 指向 `src/`。

生成页面前先看根目录 `README.md`。本目录只放页面和调用，不放权重公式，不直接读分类 JSON。

## 目录

| 路径 | 作用 |
| --- | --- |
| `index.html` | 页面壳。 |
| `vite.config.js` | 开发端口、`@` 别名、`/api` 代理。 |
| `src/main.js` | 挂上路由、Vuex 和 axios。 |
| `src/App.vue` | 顶栏、菜单、客户和版本上下文。所有页面都包在这里。右下角挂 `AgentDock`。 |
| `src/router/index.js` | 路由。`meta.group` 是菜单分组，`meta.sections` 是页内页签。 |
| `src/utils/nav.js` | 左侧菜单。页签不单列菜单项，用 `PARENT` 指回父菜单。 |
| `src/store/index.js` | 当前客户、机构、地区、规则版本、基准日。数据来自 `GET /api/bootstrap`。 |
| `src/composables/useContext.js` | 页面读取和修改上面这份上下文。 |
| `src/api/request.js` | axios 实例。成功时直接返回响应体。 |
| `src/api/*.js` | 按业务拆开的请求函数。页面只从这里要数据。 |
| `src/view/` | 一个路由一个 `.vue`。按菜单再分子目录。 |
| `src/components/` | 多页共用的抽屉、瀑布、加载、智能体停靠栏。 |
| `src/utils/` | 菜单、规则文案、瀑布布局。决策图的拖拽跟在 `mermaidStage.js`。 |
| `src/assets/main.css` | 引入 `src/assets/css/` 里的样式。新样式加在那些 css 里，或只写在单个组件上。 |
| `src/assets/mermaid.min.js` | 决策图用的 Mermaid 10.9.1。页面从这里加载，不访问外网。 |

## view 子目录

| 目录 | 页面 |
| --- | --- |
| `view/DashboardView.vue` | `/` 总览。 |
| `view/rule/` | 规则配置：版本、参数、条款、标准字段、字段映射。 |
| `view/exposure/` | 暴露分类。侧栏一项「暴露分类规则」，页签是通用、贷款、债券各自的分类 JSON。 |
| `view/ead/` | 表内 EAD、表外 EAD、转换系数。 |
| `view/measure/` | 计量向导、底稿计算、结果明细、批次、审计底稿导出。 |

页内页签不是新菜单。例如「标准字段 / 知识库字段」是 `/fields` 和 `/mappings`，菜单只挂在「产品标准字段」上。对应关系已经写在 `router/index.js` 的 `sections` 和 `nav.js` 的 `PARENT`。

## 写页面时以哪个文件为准

新页面先打开 `src/view/rule/ClausesView.vue`，沿用它的结构：`useContext()`、`AsyncView`、`panel`、`tbl`。表格列只绑定接口已经返回的键。键名到 `server/src/index.js` 里该路由的 `ctx.body` 去核对，不要按数据库列名猜驼峰。

`AsyncView` 只接受 `load`。插槽参数只有 `data` 和 `reload`。加载文案和转圈已经在组件里，页面不要再写一套「正在加载」。

`session` 只有 `store/index.js` 里的那些字段。地区下拉用 `session.jurisdictions` 的 `code` 和 `label`，与条款页相同。

样式只用 `src/assets/css/` 里已有的类，例如 `panel`、`panel-head`、`panel-body`、`tbl`、`compact`、`inline-fields`、`notice`、`danger`、`mono`、`dim`、`clickable`、`sub`。要新类就同时改对应的 css。

## 加一个页面

按这个顺序落文件。每一步都先打开清单里的现有文件再改：

1. `src/view/<分组>/<Name>View.vue`。分组用上面四个目录之一；总览级页面可以放在 `view/` 根下。
2. `src/router/index.js` 增加路由，写上 `meta.group`、`meta.title`、`meta.blurb`。若它是某个菜单下的页签，把 `{ label, path }` 放进对应的 `sections`。
3. 它是新菜单项时，改 `src/utils/nav.js` 的 `NAV`。它只是页签时，改 `PARENT`，不要再加一条菜单。
4. 需要接口时，在 `src/api/<业务>.js` 增加函数，走 `request`。没有合适的业务文件就新建一个，不要把请求写进 `.vue`。
5. 等待数据时用 `components/AsyncView.vue`，加载态是 `<span class="spin">`。空数据和错误分开显示。

页面从 `useContext()` 拿当前地区和版本，不要自己再存一份。模板里可以调用 `Math`、`Number`、`Date`、`Array`、`Object`、`Set`、`JSON`、`Map`。不要在模板里写 `Promise`。

## 已有的请求文件

| 文件 | 接口 |
| --- | --- |
| `api/bootstrap.js` | `/bootstrap` |
| `api/dashboard.js` | `/dashboard` |
| `api/rule.js` | 版本、条款、参数 |
| `api/product.js` | 产品、标准字段、字段映射 |
| `api/exposure.js` | 暴露分类页签、单份分类 JSON、权重、缓释、产品规则、决策树对话的提议、确认写入，以及按产品保存对话 |
| `api/ead.js` | 表内外 EAD 配置的读取和保存、试算、转换系数 |
| `api/batch.js` | 批次、计量演示、底稿、上传样例 |
| `api/assistant.js` | 规则助手 |
| `api/agent.js` | `/agent/chat`，只给 `AgentDock` 用 |

## 智能体停靠栏

`components/AgentDock.vue` 在每一页都在。暴露分类规则页上，页签「添加」先复制通用。对话先说明当前规则，确认后再问要不要保存，保存后才画到画布。每个产品的对话单独记在服务端，切换页签或刷新后还在。其他页面把当前路由和最近对话交给 `sendAgentChat`。返回的 `pages` 用来跳转。不要在业务页面里再接一条智能体请求。
