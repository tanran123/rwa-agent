<script setup>
import { computed, onMounted, ref } from "vue";
import { listMeta, saveConfig } from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({ task: Object, result: Object, reload: Function });

const cfg = ref(null);
const defaults = ref(null);
const error = ref("");
const busy = ref(false);
const editing = ref(null);

const CATEGORIES = [
  ["sovereign", "主权 / 中央政府"],
  ["local_gov", "地方政府"],
  ["mdb_io", "国际组织 / 多边开发银行"],
  ["policy_bank", "政策性银行"],
  ["pse", "公共部门实体（PSE）"],
  ["bank_fi", "银行 / 其他金融机构"],
  ["corporate", "公司（非金融）"]
];
const GATE1_DESC = {
  encumbered: "回购 / 质押 / 占用台账中存在的证券",
  trading_book: "交易账簿持仓不满足「压力期可变现」要求",
  fi_issuer: "银行 / 其他金融机构（或其关联实体）发行",
  structured_sub: "结构性金融工具、次级债、永续债",
  related_party: "本行或集团关联实体发行（含自持）",
  currency: "币种须为港币或可自由兑换货币"
};

function sourceCfg() {
  const result = props.result || {};
  return result.cfgSnapshot || result.cfg || props.task.cfg || {};
}

function init() {
  cfg.value = JSON.parse(JSON.stringify(sourceCfg()));
  if (!cfg.value.levels) cfg.value.levels = [];
  if (!cfg.value.gate1) cfg.value.gate1 = { checks: [] };
  if (!cfg.value.gate3) cfg.value.gate3 = { enabled: true, level2CapPct: 0.4, level2bCapPct: 0.15 };
  if (!cfg.value.checks) cfg.value.checks = {};
  if (!cfg.value.rules) cfg.value.rules = [];
}

const locked = computed(() => !!(cfg.value && cfg.value.locked));
const issues = computed(() => (props.result && props.result.analyzeRules) || []);

async function save(message) {
  busy.value = true;
  error.value = "";
  try {
    await saveConfig(props.task.id, cfg.value);
    await props.reload();
    if (message) error.value = "";
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function toggleLock() {
  const action = locked.value ? "解锁" : "锁定";
  const ok = await askConfirm(
    locked.value ? "解锁后配置可被修改，历史结论不受影响。确定解锁？" : "锁定后本页配置将变为只读，并按当前修改自动升版。确定锁定？",
    { title: `${action}判定标准` }
  );
  if (!ok) return;
  if (!locked.value) cfg.value.standardVersion = bumpVersion(cfg.value.standardVersion);
  cfg.value.locked = !locked.value;
  await save();
}

function bumpVersion(value) {
  const text = String(value || "v1.0");
  const found = text.match(/^(v?)(\d+)\.(\d+)$/);
  if (!found) return `${text}.1`;
  let major = Number(found[2]);
  let minor = Number(found[3]) + 1;
  if (minor > 9) { major += 1; minor = 0; }
  return `${found[1]}${major}.${minor}`;
}

function ruleText(when) {
  if (!when) return "—";
  const parts = [];
  if (when.fallback) parts.push("兜底");
  if (when.categories) parts.push("类型 ∈ {" + when.categories.map((c) => (CATEGORIES.find((x) => x[0] === c) || [c, c])[1]).join("、") + "}");
  if (when.kinds) parts.push("种类 ∈ {" + when.kinds.join("、") + "}");
  if (when.rw) parts.push("RW ∈ {" + when.rw.join("、") + "}%");
  if (when.maxGrade != null) parts.push(`评级不差于 ${when.maxGrade} 级`);
  if (when.maxPrice30 != null) parts.push(`跌幅 ≤ ${when.maxPrice30}%`);
  if (when.approval) parts.push("需批准");
  if (when.maxLtv != null) parts.push(`LTV ≤ ${when.maxLtv}%`);
  return parts.join("；") || "（无附加条件）";
}

function toggleRule(index) {
  cfg.value.rules[index].enabled = cfg.value.rules[index].enabled === false;
  save();
}

function moveRule(index, delta) {
  const rules = cfg.value.rules;
  const target = index + delta;
  if (target < 0 || target >= rules.length) return;
  const [item] = rules.splice(index, 1);
  rules.splice(target, 0, item);
  save();
}

async function deleteRule(index) {
  const ok = await askConfirm(`将删除规则 ${cfg.value.rules[index].id}，确定继续？`, { title: "删除规则", danger: true });
  if (!ok) return;
  cfg.value.rules.splice(index, 1);
  await save();
}

function newRule() {
  const n = cfg.value.rules.length + 1;
  editing.value = {
    index: -1,
    rule: { id: `R${n}`, enabled: true, target: "L2B", clause: "—", label: "新规则", when: {} }
  };
}

function editRule(index) {
  editing.value = { index, rule: JSON.parse(JSON.stringify(cfg.value.rules[index])) };
}

function toggleCategory(rule, code) {
  const list = rule.when.categories ? [...rule.when.categories] : [];
  const at = list.indexOf(code);
  if (at >= 0) list.splice(at, 1);
  else list.push(code);
  if (list.length) rule.when.categories = list;
  else delete rule.when.categories;
}

function parseList(text) {
  return String(text || "").split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
}

function saveRule() {
  const rule = editing.value.rule;
  if (!rule.id || !rule.label) {
    error.value = "规则编号和名称不能为空";
    return;
  }
  if (editing.value.index < 0) cfg.value.rules.push(rule);
  else cfg.value.rules.splice(editing.value.index, 1, rule);
  editing.value = null;
  save();
}

async function restore() {
  const ok = await askConfirm("将把所选区块恢复为默认值，不影响已导入的数据。确定继续？", { title: "恢复默认判定标准", danger: true });
  if (!ok) return;
  if (!defaults.value) defaults.value = (await listMeta()).cfg;
  cfg.value.gate1 = JSON.parse(JSON.stringify(defaults.value.gate1));
  cfg.value.rules = JSON.parse(JSON.stringify(defaults.value.rules));
  cfg.value.gate2 = JSON.parse(JSON.stringify(defaults.value.gate2));
  cfg.value.gate3 = JSON.parse(JSON.stringify(defaults.value.gate3));
  cfg.value.checks = JSON.parse(JSON.stringify(defaults.value.checks));
  await save();
}

async function changeBaseDate(event) {
  const next = event.target.value;
  if (!next || next === cfg.value.baseDate) return;
  const count = ((props.result && props.result.rows) || []).filter((r) => !r.isAdjustment).length;
  const ok = await askConfirm(`基准日将从 ${cfg.value.baseDate} 变更为 ${next}。\n\n这将重算全部 ${count} 笔债券的剩余期限、到期判定与期限分档，可能改变判定结论。确定变更？`, { title: "变更基准日" });
  if (!ok) {
    event.target.value = cfg.value.baseDate;
    return;
  }
  cfg.value.baseDate = next;
  if (!cfg.value.effectiveFrom || cfg.value.effectiveFrom > next) cfg.value.effectiveFrom = next;
  await save();
}

function addCurrency(check, value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return;
  check.allowed = check.allowed || [];
  if (!check.allowed.includes(code)) check.allowed.push(code);
  save();
}

function removeCurrency(check, code) {
  check.allowed = (check.allowed || []).filter((x) => x !== code);
  save();
}

onMounted(init);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <p v-if="issues.length" class="notice warn">
    规则体检：{{ issues.map((x) => x.text).join("；") }}
  </p>

  <div v-if="cfg">
    <div class="panel" style="margin-bottom: 12px">
      <div class="panel-head">
        <h3>③-0 任务参数</h3>
        <span class="sub">基准日与判定标准版本；锁定后本页只读</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm" :disabled="busy" @click="toggleLock">{{ locked ? "解锁" : "锁定" }}</button>
      </div>
      <div class="panel-body">
        <div class="grid c4">
          <label class="field"><span>基准日</span><input type="date" :value="cfg.baseDate" :disabled="locked" @change="changeBaseDate" /></label>
          <label class="field"><span>标准版本</span><input v-model="cfg.standardVersion" type="text" :disabled="locked" @change="save()" /></label>
          <label class="field"><span>生效日</span><input v-model="cfg.effectiveFrom" type="date" :disabled="locked" @change="save()" /></label>
          <div class="field">
            <span>标准锁定</span>
            <div style="display: flex; align-items: center; gap: 8px">
              <span class="tag" :class="locked ? 'ok' : 'muted'">{{ locked ? "已锁定（只读）" : "未锁定" }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div :style="locked ? { pointerEvents: 'none', opacity: 0.78 } : null">
      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>③-1 关卡一 · 通用合格性</h3><span class="sub">任一命中即不合格；判定依据来自第 2 步导入的清单</span></div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th style="width: 30%">检查项</th><th style="width: 44%">判定依据</th><th style="width: 26%">参数</th></tr></thead>
            <tbody>
              <tr v-for="check in cfg.gate1.checks" :key="check.code" :class="{ dim: check.enabled === false }">
                <td>
                  <label class="checkline">
                    <input type="checkbox" :checked="check.enabled !== false" @change="check.enabled = $event.target.checked; save()" />
                    <span>{{ check.label || check.code }}</span>
                  </label>
                </td>
                <td class="dim" style="font-size: 11px">{{ GATE1_DESC[check.code] || "" }}</td>
                <td>
                  <div v-if="check.code === 'currency'" style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center">
                    <span v-for="code in check.allowed || []" :key="code" class="tag muted" style="display: inline-flex; gap: 4px; align-items: center">
                      {{ code }}<b style="cursor: pointer; color: var(--danger)" @click="removeCurrency(check, code)">✕</b>
                    </span>
                    <input type="text" placeholder="加币种" style="width: 76px; font-size: 11px" @keydown.enter="addCurrency(check, $event.target.value); $event.target.value = ''" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <label class="checkline" style="margin-top: 10px">
            <input
              type="checkbox"
              :checked="(cfg.gate1.checks.find((x) => x.code === 'fi_issuer') || {}).policyBankException !== false"
              @change="(cfg.gate1.checks.find((x) => x.code === 'fi_issuer') || {}).policyBankException = $event.target.checked; save()"
            />
            <span>政策性银行豁免「金融机构」排除</span>
          </label>
        </div>
      </div>

      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head">
          <h3>③-2 关卡二 · 档位与分档规则</h3>
          <span class="sub">自上而下首条命中即定档</span>
          <span class="spacer"></span>
          <button type="button" class="btn sm primary" @click="newRule">新增规则</button>
          <button type="button" class="btn sm" @click="restore">恢复默认</button>
        </div>
        <div class="panel-body tight">
          <table class="tbl compact">
            <thead><tr><th>档位</th><th>折扣系数</th><th>口径说明</th></tr></thead>
            <tbody>
              <tr v-for="level in cfg.levels" :key="level.code">
                <td><b>{{ level.label }}</b><div class="dim" style="font-size: 10.5px">{{ level.short }}</div></td>
                <td>
                  <input
                    type="number" min="0" max="100" step="1" style="width: 72px"
                    :value="Math.round(level.weight * 100)" :disabled="level.code === 'NA'"
                    @change="level.weight = Math.max(0, Math.min(100, Number($event.target.value) || 0)) / 100; save()"
                  /> %
                </td>
                <td class="dim" style="font-size: 11px; line-height: 1.55">{{ level.note }}</td>
              </tr>
            </tbody>
          </table>

          <table class="tbl compact" style="margin-top: 14px">
            <thead><tr><th>编号</th><th>规则与条件</th><th>目标档位</th><th>条款</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="(rule, index) in cfg.rules" :key="rule.id" :class="{ dim: rule.enabled === false }">
                <td class="mono">{{ rule.id }}</td>
                <td>
                  <div style="font-weight: 500">{{ rule.label }}</div>
                  <div class="dim" style="font-size: 10.5px">{{ ruleText(rule.when) }}</div>
                </td>
                <td>{{ (cfg.levels.find((l) => l.code === rule.target) || {}).label || rule.target }}</td>
                <td class="dim" style="font-size: 11px">{{ rule.clause || "—" }}</td>
                <td>
                  <div style="display: flex; gap: 4px">
                    <button type="button" class="btn sm" @click="toggleRule(index)">{{ rule.enabled === false ? "启用" : "停用" }}</button>
                    <button type="button" class="btn sm" @click="editRule(index)">编辑</button>
                    <button type="button" class="btn sm" :disabled="index === 0" @click="moveRule(index, -1)">↑</button>
                    <button type="button" class="btn sm" :disabled="index === cfg.rules.length - 1" @click="moveRule(index, 1)">↓</button>
                    <button type="button" class="btn sm danger" @click="deleteRule(index)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <label class="checkline" style="margin-top: 10px">
            <input
              type="checkbox"
              :checked="(cfg.gate2 || {}).missingDataPolicy !== 'fail'"
              @change="cfg.gate2 = cfg.gate2 || {}; cfg.gate2.missingDataPolicy = $event.target.checked ? 'warn' : 'fail'; save()"
            />
            <span>缺少 30 天价格数据时暂按满足处理（结论标注「需补证」）</span>
          </label>
        </div>
      </div>

      <div class="panel" style="margin-bottom: 12px">
        <div class="panel-head"><h3>③-3 关卡三 · 组合上限</h3><span class="sub">以最终 HQLA 加权金额为基数，超出部分按比例剔除</span></div>
        <div class="panel-body">
          <div class="grid c3">
            <label class="checkline"><input type="checkbox" :checked="cfg.gate3.enabled !== false" @change="cfg.gate3.enabled = $event.target.checked; save()" /><span>启用组合上限校验</span></label>
            <label class="field">
              <span>Level 2A + 2B 合计上限（%）</span>
              <input type="number" min="0" max="100" :value="Math.round(cfg.gate3.level2CapPct * 100)" @change="cfg.gate3.level2CapPct = Math.max(0, Math.min(100, Number($event.target.value) || 0)) / 100; save()" />
            </label>
            <label class="field">
              <span>Level 2B 单独上限（%）</span>
              <input type="number" min="0" max="100" :value="Math.round(cfg.gate3.level2bCapPct * 100)" @change="cfg.gate3.level2bCapPct = Math.max(0, Math.min(100, Number($event.target.value) || 0)) / 100; save()" />
            </label>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>③-3b 核对参数</h3><span class="sub">估值与期限口径（对账容差在第 7 步设置）</span></div>
        <div class="panel-body">
          <div class="grid c4">
            <label class="field">
              <span>估值核对口径</span>
              <select v-model="cfg.checks.valuation.basis" @change="save()">
                <option value="market">市值 ＋ 应计利息</option>
                <option value="book">账面 ＋ 应计 ＋ 减值（摊余成本类）</option>
              </select>
            </label>
            <label class="field"><span>估值容差（绝对）</span><input type="number" v-model.number="cfg.checks.valuation.toleranceAbs" @change="save()" /></label>
            <label class="field"><span>估值容差（相对）</span><input type="number" step="0.0001" v-model.number="cfg.checks.valuation.tolerancePct" @change="save()" /></label>
            <label class="field"><span>期限观察期（天）</span><input type="number" v-model.number="cfg.checks.maturity.lcrDays" @change="save()" /></label>
          </div>
        </div>
      </div>
    </div>

    <div v-if="editing" class="panel" style="margin-top: 12px">
      <div class="panel-head">
        <h3>{{ editing.index < 0 ? "新增分档规则" : `编辑规则 ${editing.rule.id}` }}</h3>
        <span class="spacer"></span>
        <button type="button" class="btn sm" @click="editing = null">取消</button>
        <button type="button" class="btn sm primary" @click="saveRule">保存</button>
      </div>
      <div class="panel-body">
        <div class="grid c4">
          <label class="field"><span>编号</span><input v-model="editing.rule.id" type="text" :disabled="editing.index >= 0" /></label>
          <label class="field"><span>名称</span><input v-model="editing.rule.label" type="text" /></label>
          <label class="field">
            <span>目标档位</span>
            <select v-model="editing.rule.target">
              <option v-for="level in cfg.levels" :key="level.code" :value="level.code">{{ level.label }}</option>
            </select>
          </label>
          <label class="field"><span>监管条款</span><input v-model="editing.rule.clause" type="text" /></label>
        </div>
        <div style="margin-top: 10px; font-size: 11.5px; font-weight: 600">命中条件</div>
        <label class="checkline" style="margin: 6px 0">
          <input type="checkbox" :checked="!!editing.rule.when.fallback" @change="editing.rule.when.fallback = $event.target.checked || undefined" />
          <span>兜底规则（不满足前述任何档位）</span>
        </label>
        <div class="grid c3">
          <div class="field">
            <span>发行人类型</span>
            <div style="display: flex; flex-wrap: wrap; gap: 8px">
              <label v-for="[code, label] in CATEGORIES" :key="code" class="checkline" style="font-size: 11px">
                <input type="checkbox" :checked="(editing.rule.when.categories || []).includes(code)" @change="toggleCategory(editing.rule, code)" />
                <span>{{ label }}</span>
              </label>
            </div>
          </div>
          <label class="field">
            <span>标准法风险权重（%，逗号分隔）</span>
            <input
              type="text" :value="(editing.rule.when.rw || []).join(',')"
              @change="editing.rule.when.rw = $event.target.value ? parseList($event.target.value).map(Number) : undefined"
            />
          </label>
          <label class="field">
            <span>债券种类（逗号分隔）</span>
            <input type="text" :value="(editing.rule.when.kinds || []).join(',')" @change="editing.rule.when.kinds = $event.target.value ? parseList($event.target.value) : undefined" />
          </label>
          <label class="field"><span>评级不差于（1–6）</span><input type="number" min="1" max="6" :value="editing.rule.when.maxGrade ?? ''" @change="editing.rule.when.maxGrade = $event.target.value === '' ? undefined : Number($event.target.value)" /></label>
          <label class="field"><span>30 天跌幅 ≤（%）</span><input type="number" :value="editing.rule.when.maxPrice30 ?? ''" @change="editing.rule.when.maxPrice30 = $event.target.value === '' ? undefined : Number($event.target.value)" /></label>
          <label class="field"><span>LTV ≤（%）</span><input type="number" :value="editing.rule.when.maxLtv ?? ''" @change="editing.rule.when.maxLtv = $event.target.value === '' ? undefined : Number($event.target.value)" /></label>
          <label class="checkline"><input type="checkbox" :checked="!!editing.rule.when.approval" @change="editing.rule.when.approval = $event.target.checked || undefined" /><span>需金管局批准</span></label>
        </div>
      </div>
    </div>
  </div>
</template>
