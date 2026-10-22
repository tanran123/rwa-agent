import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../view/DashboardView.vue'
import VersionsView from '../view/rule/VersionsView.vue'
import ParamsView from '../view/rule/ParamsView.vue'
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
import ExportView from '../view/measure/ExportView.vue'

const versionTabs = [
  { label: '版本', path: '/versions' },
  { label: '共用参数', path: '/params' },
]
const fieldTabs = [
  { label: '标准字段', path: '/fields' },
  { label: '知识库字段', path: '/mappings' },
]
const classTabs = [
  { label: '分类规则', path: '/generic' },
  { label: '产品线路', path: '/exposure' },
  { label: '缓释', path: '/crm' },
]
const wizardTabs = [
  { label: '计量向导', path: '/wizard' },
  { label: '底稿计算', path: '/engine' },
]

const routes = [
  { path: '/', name: 'dashboard', component: DashboardView, meta: { group: '总览', title: '首页 / 计量工作台', blurb: '按菜单顺序走：规则配置、暴露分类规则、EAD，然后计量。' } },
  { path: '/versions', name: 'versions', component: VersionsView, meta: { group: '规则配置', title: '监管规则版本管理', blurb: '三地规则分开维护。在已有版本上复制后再改，避免互相覆盖。', sections: versionTabs } },
  { path: '/params', name: 'params', component: ParamsView, meta: { group: '规则配置', title: '共用参数', blurb: '多条规则共用的门槛。评级百分比在权重表里改。', sections: versionTabs } },
  { path: '/clauses', name: 'clauses', component: ClausesView, meta: { group: '规则配置', title: '监管条款库', blurb: '条款和引用它的规则放在同一张表里。点一行看原文和引用。' } },
  { path: '/fields', name: 'fields', component: FieldsView, meta: { group: '规则配置', title: '产品标准字段管理', blurb: '规则写字段 name，不写 Excel 表头。手工字段不要从表格对齐。', sections: fieldTabs } },
  { path: '/mappings', name: 'mappings', component: MappingsView, meta: { group: '规则配置', title: '字段映射', blurb: '源系统字段对到标准字段。', sections: fieldTabs } },
  { path: '/generic', name: 'generic', component: GenericView, meta: { group: '暴露分类规则', title: '通用暴露分类规则', blurb: '分类瀑布。命中进入下级，本层都不成立再看下一条。', sections: classTabs } },
  { path: '/exposure', name: 'exposure', component: ExposureView, meta: { group: '暴露分类规则', title: '产品线路', blurb: '每个产品挂在通用分类上的专属规则。', sections: classTabs } },
  { path: '/crm', name: 'crm', component: CrmView, meta: { group: '暴露分类规则', title: '信用风险缓释', blurb: '合格工具，以及什么情况下这条缓释不计入。', sections: classTabs } },
  { path: '/product-rules', name: 'product-rules', component: ProductRulesView, meta: { group: '暴露分类规则', title: '产品专属暴露分类规则', blurb: '在通用分类框架基础上，用产品标准字段绑定通用规则字段，向导式建立每个产品的暴露分类规则' } },
  { path: '/tree', name: 'tree', component: TreeView, meta: { group: '暴露分类规则', title: '暴露分类规则', chart: true } },
  { path: '/tree/:name', name: 'tree-doc', component: TreeView, meta: { group: '暴露分类规则', title: '暴露分类规则', chart: true } },
  { path: '/weights', name: 'weights', component: WeightsView, meta: { group: '暴露分类规则', title: '风险权重', blurb: '权重表。没有单列的档位保持未列明。' } },
  { path: '/assistant', name: 'assistant', component: AssistantView, meta: { group: '暴露分类规则', title: '自然语言规则配置助手', blurb: '先识别再生成。生成的规则要确认后才保存，对话是预置脚本。' } },
  { path: '/ead', name: 'ead', component: EadView, meta: { group: 'EAD 计算规则', title: 'EAD 计算规则配置', blurb: '按产品逐个配置；同一产品只会配表内或表外其中之一，二者互斥。' } },
  { path: '/ead-on', redirect: '/ead' },
  { path: '/ead-off', redirect: '/ead' },
  { path: '/ccf', name: 'ccf', component: CcfView, meta: { group: 'EAD 计算规则', title: '信用转换系数', blurb: '一行是一种表外类型加一个条件。' } },
  { path: '/crm-config', name: 'crm-config', component: CrmConfigView, meta: { group: '信用风险缓释', title: '信用风险缓释配置', blurb: '按产品绑定缓释字段并维护合格缓释物字典。产品清单读 product_type，可选列读 product_field。' } },
  { path: '/wizard', name: 'wizard', component: WizardView, meta: { group: '计量执行', title: '信用风险 RWA 计量向导', blurb: '分步骤完成从计量范围选择、数据导入到计量结果查看的全过程', sections: wizardTabs } },
  { path: '/engine', name: 'engine', component: EngineView, meta: { group: '计量执行', title: '底稿计算', blurb: '映射、计算、追溯。逐笔结果写入计量明细后在结果页查看。', sections: wizardTabs } },
  { path: '/results', name: 'results', component: ResultsView, meta: { group: '计量执行', title: '计量结果明细', blurb: '逐笔债项计量结果与审计证据；点击任意债项进入该笔的完整计量详情页' } },
  { path: '/batches', name: 'batches', component: BatchesView, meta: { group: '计量执行', title: '计量批次管理', blurb: '每个批次固定当时的规则版本。规则更新后，历史批次不改。' } },
  { path: '/export', name: 'export', component: ExportView, meta: { group: '计量执行', title: 'Excel 审计底稿导出', blurb: '导出真实的 xlsx。底稿里的业务数据是模拟数据。' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
