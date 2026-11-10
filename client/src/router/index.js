import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../view/DashboardView.vue'
import VersionsView from '../view/rule/VersionsView.vue'
import RuleWorkbenchView from '../view/rule/RuleWorkbenchView.vue'
import OrgsView from '../view/rule/OrgsView.vue'
import ClausesView from '../view/rule/ClausesView.vue'
import FieldsView from '../view/rule/FieldsView.vue'
import MappingsView from '../view/rule/MappingsView.vue'
import GenericView from '../view/exposure/GenericView.vue'
import ExposureView from '../view/exposure/ExposureView.vue'
import CrmView from '../view/exposure/CrmView.vue'
import ProductRulesView from '../view/exposure/ProductRulesView.vue'
import TreeView from '../view/exposure/TreeView.vue'
import WeightsView from '../view/exposure/WeightsView.vue'
import AssistantView from '../view/exposure/AssistantView.vue'
import EadView from '../view/ead/EadView.vue'
import CcfView from '../view/ead/CcfView.vue'
import CrmConfigView from '../view/crm/CrmConfigView.vue'
import WizardView from '../view/measure/WizardView.vue'
import EngineView from '../view/measure/EngineView.vue'
import ResultsView from '../view/measure/ResultsView.vue'
import BatchesView from '../view/measure/BatchesView.vue'
import TasksView from '../view/measure/TasksView.vue'
import TaskDetailView from '../view/measure/TaskDetailView.vue'
import ExportView from '../view/measure/ExportView.vue'
import HqlaTasksView from '../view/hqla/HqlaTasksView.vue'
import HqlaWizardView from '../view/hqla/HqlaWizardView.vue'
import LoginView from '../view/system/LoginView.vue'
import UsersView from '../view/system/UsersView.vue'
import RolesView from '../view/system/RolesView.vue'
import PermissionsView from '../view/system/PermissionsView.vue'
import LogsView from '../view/system/LogsView.vue'
import LlmView from '../view/system/LlmView.vue'
import TokensView from '../view/system/TokensView.vue'
import { currentUser, can } from '@/utils/auth'
import { menuIdFor } from '@/utils/nav'

const fieldTabs = [
  { label: '标准字段', path: '/fields' },
  { label: '知识库字段', path: '/mappings' },
]
const classTabs = [
  { label: '分类规则', path: '/generic' },
  { label: '产品线路', path: '/exposure' },
  { label: '缓释', path: '/crm' },
]
const routes = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true, title: '登录', full: true } },
  { path: '/', name: 'dashboard', component: DashboardView, meta: { group: '总览', title: '首页 / 计量工作台', blurb: '按菜单顺序走：规则配置，然后计量。' } },
  { path: '/versions', name: 'versions', component: VersionsView, meta: { group: '规则配置', title: '监管规则版本管理', blurb: '三地规则分开维护。在已有版本上复制后再改，避免互相覆盖。' } },
  { path: '/versions/new/workbench', name: 'version-new-workbench', component: RuleWorkbenchView, meta: { group: '规则配置', title: '监管规则维护工作台', blurb: '先填写版本信息，创建后进入这一版的配置。' } },
  { path: '/versions/:id/workbench', name: 'version-workbench', component: RuleWorkbenchView, meta: { group: '规则配置', title: '监管规则维护工作台', blurb: '资本充足率和流动性两大模块，各自链接到这一版的具体配置。' } },
  { path: '/orgs', name: 'orgs', component: OrgsView, meta: { group: '规则配置', title: '机构', blurb: '左上角机构和版本的适用机构都用这份名单。按当前地区列出。' } },
  { path: '/clauses', name: 'clauses', component: ClausesView, meta: { group: '规则配置', title: '监管条款库', blurb: '条款和引用它的规则放在同一张表里。点一行看原文和引用。', versionContext: true } },
  { path: '/fields', name: 'fields', component: FieldsView, meta: { group: '规则配置', title: '产品标准字段管理', blurb: '规则写字段 name，不写 Excel 表头。手工字段不要从表格对齐。', sections: fieldTabs, versionContext: true } },
  { path: '/mappings', name: 'mappings', component: MappingsView, meta: { group: '规则配置', title: '字段映射', blurb: '源系统字段对到标准字段。', sections: fieldTabs, versionContext: true } },
  { path: '/generic', name: 'generic', component: GenericView, meta: { group: '规则配置', title: '通用暴露分类规则', blurb: '分类瀑布。命中进入下级，本层都不成立再看下一条。', sections: classTabs, versionContext: true } },
  { path: '/exposure', name: 'exposure', component: ExposureView, meta: { group: '规则配置', title: '产品线路', blurb: '每个产品挂在通用分类上的专属规则。', sections: classTabs, versionContext: true } },
  { path: '/crm', name: 'crm', component: CrmView, meta: { group: '规则配置', title: '信用风险缓释', blurb: '合格工具，以及什么情况下这条缓释不计入。', sections: classTabs, versionContext: true } },
  { path: '/product-rules', name: 'product-rules', component: ProductRulesView, meta: { group: '规则配置', title: '产品专属暴露分类规则', blurb: '在通用分类框架基础上，用产品标准字段绑定通用规则字段，向导式建立每个产品的暴露分类规则', versionContext: true } },
  { path: '/tree', name: 'tree', component: TreeView, meta: { group: '规则配置', title: '暴露分类规则', chart: true, versionContext: true } },
  { path: '/tree/:name', name: 'tree-doc', component: TreeView, meta: { group: '规则配置', title: '暴露分类规则', chart: true, versionContext: true } },
  { path: '/weights', name: 'weights', component: WeightsView, meta: { group: '规则配置', title: '风险权重', blurb: '权重表。没有单列的档位保持未列明。', versionContext: true } },
  { path: '/assistant', name: 'assistant', component: AssistantView, meta: { group: '规则配置', title: '自然语言规则配置助手', blurb: '先识别再生成。生成的规则要确认后才保存，对话是预置脚本。', versionContext: true } },
  { path: '/ead', name: 'ead', component: EadView, meta: { group: '规则配置', title: 'EAD 计算规则配置', blurb: '按产品逐个配置；同一产品只会配表内或表外其中之一，二者互斥。', versionContext: true } },
  { path: '/ead-on', redirect: '/ead' },
  { path: '/ead-off', redirect: '/ead' },
  { path: '/ccf', name: 'ccf', component: CcfView, meta: { group: '规则配置', title: '信用转换系数', blurb: '一行是一种表外类型加一个条件。', versionContext: true } },
  { path: '/crm-config', name: 'crm-config', component: CrmConfigView, meta: { group: '规则配置', title: '信用风险缓释配置', blurb: '按产品绑定缓释字段并维护合格缓释物字典。产品清单读 product_type，可选列读 product_field。', versionContext: true } },
  { path: '/tasks', name: 'tasks', component: TasksView, meta: { group: '任务运行', title: '任务工作台', blurb: '每个季度一个主任务。创建时固定监管版本和机构，列表统计资本充足率和流动性子任务的数量与进度，点任务进入详情工作台。' } },
  { path: '/tasks/:id', name: 'task-detail', component: TaskDetailView, meta: { group: '任务运行', title: '任务详情工作台', blurb: '在资本充足率和流动性两个模块下新增子任务，并进入各自的计算。' } },
  { path: '/wizard', name: 'wizard', component: WizardView, meta: { group: '任务运行', title: '信用风险 RWA 计量向导', blurb: '分步骤完成从计量范围选择、数据导入到计量结果查看的全过程' } },
  { path: '/engine', name: 'engine', component: EngineView, meta: { group: '任务运行', title: '底稿计算', blurb: '映射、计算、追溯。逐笔结果写入计量明细后在结果页查看。' } },
  { path: '/results', name: 'results', component: ResultsView, meta: { group: '任务运行', title: '计量结果明细', blurb: '逐笔债项计量结果与审计证据；点击任意债项进入该笔的完整计量详情页' } },
  { path: '/batches', name: 'batches', component: BatchesView, meta: { group: '任务运行', title: '计量批次管理', blurb: '每个批次固定当时的规则版本。规则更新后，历史批次不改。' } },
  { path: '/export', name: 'export', component: ExportView, meta: { group: '任务运行', title: 'Excel 审计底稿导出', blurb: '导出真实的 xlsx。底稿里的业务数据是模拟数据。' } },
  { path: '/hqla', name: 'hqla', component: HqlaTasksView, meta: { group: '任务运行', title: 'HQLA 计算任务', blurb: '按任务组织：新建、复制、归档、导入归档。每个任务独立保存自己的明细、清单、判定标准与结论。', versionContext: true } },
  { path: '/hqla/:id', name: 'hqla-wizard', component: HqlaWizardView, meta: { group: '任务运行', title: '当前任务向导', blurb: '七步：明细 → 清单 → 标准 → 抽样 → 取数 → 核对 → 对账。', versionContext: true } },
  { path: '/system/users', name: 'sys-users', component: UsersView, meta: { group: '系统管理', title: '用户管理', blurb: '管理平台账号、角色与授权机构。账号停用后立即失去访问权限；当前登录账号不可停用。', menu: 'sys-users' } },
  { path: '/system/roles', name: 'sys-roles', component: RolesView, meta: { group: '系统管理', title: '角色管理', blurb: '角色是菜单权限与授权机构的模板。角色停用后，其下账号保留数据但无法登录。', menu: 'sys-roles' } },
  { path: '/system/permissions', name: 'sys-perms', component: PermissionsView, meta: { group: '系统管理', title: '权限管理', blurb: '按角色配置可见菜单。这里控制的是「能否看到入口」，机构级数据权限仍由用户授权机构控制。', menu: 'sys-perms' } },
  { path: '/system/logs', name: 'sys-logs', component: LogsView, meta: { group: '系统管理', title: '操作日志', blurb: '记录登录、用户与角色变更、配置修改等关键动作，用于回答「谁在何时做了什么」。', menu: 'sys-logs' } },
  { path: '/system/llm', name: 'sys-llm', component: LlmView, meta: { group: '系统管理', title: '大模型配置', blurb: '每个账号只能配置自己调用的大模型 API；不同用户之间的 Base URL、模型与密钥相互隔离。', menu: 'sys-llm' } },
  { path: '/system/tokens', name: 'sys-tokens', component: TokensView, meta: { group: '系统管理', title: 'Token 调用', blurb: '按时间区间与用户筛选模型调用明细，统计口径只覆盖所选区间、用户与模型。', menu: 'sys-tokens' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const user = currentUser()
  if (to.meta.public) {
    if (user && to.path === '/login') return { path: '/' }
    return true
  }
  if (!user) return { path: '/login', query: { redirect: to.fullPath } }
  const menu = to.meta.menu || menuIdFor(to.path)
  if (menu && !can(menu)) return { path: '/' }
  return true
})

export default router
