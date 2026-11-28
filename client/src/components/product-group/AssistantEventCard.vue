<script setup>
import { computed, ref } from "vue";
import { agentHtml } from "@/utils/agentText";

const props = defineProps({
  event: { type: Object, required: true },
  readOnly: { type: Boolean, default: false },
  loading: { type: Boolean, default: false }
});
const emit = defineEmits(["action"]);

const open = ref(props.event.type === "diff");
const expandedAll = ref(false);
const expandedRow = ref("");
const copied = ref(false);

const type = computed(() => props.event.type || "assistant_answer");
const text = computed(() => String(props.event.text || ""));
const long = computed(() => {
  if (text.value.length > 600) return true;
  return text.value.split("\n").length > 8;
});
const visibleText = computed(() => {
  if (!long.value || open.value) return text.value;
  // 流式输出时跟着最新内容走，不然超过 600 字后看起来就不动了。
  if (props.event.streaming) return "…" + text.value.slice(-600);
  const lines = text.value.split("\n");
  if (lines.length > 6) return lines.slice(0, 6).join("\n") + "\n…";
  return text.value.slice(0, 600) + "…";
});
const html = computed(() => agentHtml(visibleText.value));

const confidencePct = computed(() => Math.round((Number(props.event.confidence) || 0) * 100));
const lowConfidence = computed(() => Number(props.event.confidence || 0) < 0.7);

const findings = computed(() => props.event.findings || []);
const errorCount = computed(() => findings.value.filter((item) => item.severity === "error").length);
const warningCount = computed(() => findings.value.length - errorCount.value);
const visibleFindings = computed(() => (
  open.value || findings.value.length <= 5 ? findings.value : findings.value.slice(0, 5)
));
const fixableCount = computed(() => findings.value.filter((item) => item && item.suggestedAction).length);

const rows = computed(() => props.event.rows || []);
const visibleRows = computed(() => (expandedAll.value ? rows.value : rows.value.slice(0, 8)));

const conflicts = computed(() => props.event.conflicts || []);

const stageLines = computed(() => props.event.lines || []);
const visibleLines = computed(() => {
  if (open.value || stageLines.value.length <= 6) return stageLines.value;
  return stageLines.value.slice(-6);
});
const hiddenLineCount = computed(() => Math.max(0, stageLines.value.length - visibleLines.value.length));

const stats = computed(() => props.event.stats || []);

const diffGroups = computed(() => {
  const diff = props.event.diff || {};
  return [
    { key: "addedDecisions", label: "新增决策", items: diff.addedDecisions || [] },
    { key: "changedDecisions", label: "修改决策", items: diff.changedDecisions || [] },
    { key: "removedDecisions", label: "删除决策", items: diff.removedDecisions || [] },
    { key: "addedFields", label: "新增标准字段", items: diff.addedFields || [] },
    { key: "removedFields", label: "移除标准字段", items: diff.removedFields || [] },
    { key: "addedMappings", label: "新增映射", items: diff.addedMappings || [] },
    { key: "removedMappings", label: "移除映射", items: diff.removedMappings || [] },
    { key: "addedDictionaries", label: "新增字典", items: diff.addedDictionaries || [] },
    { key: "removedDictionaries", label: "移除字典", items: diff.removedDictionaries || [] }
  ].filter((group) => group.items.length);
});

function timeText(value) {
  const at = Number(value) || 0;
  if (!at) return "";
  return new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function action(key, extra = {}) {
  emit("action", { key, ...extra });
}
async function copyText() {
  try {
    await navigator.clipboard.writeText(text.value);
    copied.value = true;
    window.setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    copied.value = false;
  }
}
function toggleRow(target) {
  expandedRow.value = expandedRow.value === target ? "" : target;
}
</script>

<template>
  <div class="pec" :class="'pec-' + type">
    <!-- 用户要求 -->
    <template v-if="type === 'user_message'">
      <div class="pec-user-bubble">{{ event.text }}</div>
      <div class="pec-user-meta">
        <span v-if="event.at">{{ timeText(event.at) }}</span>
        <span v-if="event.groupLabel" class="pec-dot">·</span>
        <span v-if="event.groupLabel">{{ event.groupLabel }}</span>
      </div>
    </template>

    <!-- 助手回答 -->
    <template v-else-if="type === 'assistant_answer'">
      <div class="pec-head">
        <span class="pec-kind">助手</span>
        <span class="spacer"></span>
        <button type="button" class="pec-icon" :title="copied ? '已复制' : '复制回答'" @click="copyText">{{ copied ? "已复制" : "复制" }}</button>
        <span v-if="event.at" class="pec-time">{{ timeText(event.at) }}</span>
      </div>
      <div class="pec-rich" v-html="html"></div>
      <div v-if="event.note" class="pec-note">{{ event.note }}</div>
      <div v-if="long" class="pec-foot">
        <button type="button" class="pec-link" @click="open = !open">{{ open ? "收起" : "展开全部（" + text.length + " 字）" }}</button>
      </div>
      <div v-if="event.streaming" class="pec-streaming">正在输出…</div>
    </template>

    <!-- 意图识别 -->
    <template v-else-if="type === 'intent'">
      <div class="pec-head">
        <span class="pec-kind">识别</span>
        <span class="pec-title">{{ event.title }}</span>
        <span class="spacer"></span>
        <span v-if="event.at" class="pec-time">{{ timeText(event.at) }}</span>
      </div>
      <div class="pec-row">
        <span v-if="event.typeLabel" class="pec-tag blue">{{ event.typeLabel }}</span>
        <span v-if="event.confidence" class="pec-conf" :class="{ low: lowConfidence }">置信度 {{ confidencePct }}%</span>
        <span v-if="lowConfidence" class="pec-warn">建议确认</span>
      </div>
    </template>

    <!-- 执行计划 -->
    <template v-else-if="type === 'plan'">
      <div class="pec-head">
        <span class="pec-kind">计划</span>
        <span class="pec-title">{{ event.title }}</span>
        <span class="spacer"></span>
        <span v-if="event.at" class="pec-time">{{ timeText(event.at) }}</span>
      </div>
      <div v-if="!open && !loading && (event.tasks || []).length" class="pec-note">
        共 {{ event.tasks.length }} 个步骤<button type="button" class="pec-link inline" @click="open = true">展开</button>
      </div>
      <ol v-else class="pec-plan-list">
        <li v-for="(task, index) in event.tasks || []" :key="index + ':' + task">{{ task }}</li>
      </ol>
    </template>

    <!-- 执行阶段 -->
    <template v-else-if="type === 'stage'">
      <div class="pec-head">
        <span class="pec-kind">过程</span>
        <span class="pec-title">{{ event.title || "执行过程" }}</span>
        <span v-if="event.active" class="pec-spinner" aria-label="进行中"></span>
        <span class="spacer"></span>
        <span v-if="event.at" class="pec-time">{{ timeText(event.at) }}</span>
      </div>
      <div v-if="event.message" class="pec-note">{{ event.message }}</div>
      <div v-if="event.total" class="pec-bar"><i :style="{ width: Math.round(((event.done || 0) / event.total) * 100) + '%' }"></i></div>
      <div v-if="event.total" class="pec-meta">{{ event.done || 0 }} / {{ event.total }} 个监管字段已决策</div>
      <ul v-if="visibleLines.length" class="pec-lines">
        <li v-for="(line, index) in visibleLines" :key="index + ':' + line.text" :class="line.kind">
          <span class="pec-line-dot"></span>
          <span>{{ line.text }}</span>
        </li>
      </ul>
      <div v-if="hiddenLineCount || open" class="pec-foot">
        <button type="button" class="pec-link" @click="open = !open">{{ open ? "收起过程" : "显示全部过程（+" + hiddenLineCount + "）" }}</button>
      </div>
    </template>

    <!-- 配置结果摘要 -->
    <template v-else-if="type === 'decision_summary'">
      <div class="pec-head">
        <span class="pec-kind">结果</span>
        <span class="pec-title">{{ event.title || "本次配置调整" }}</span>
        <span class="spacer"></span>
        <span v-if="event.at" class="pec-time">{{ timeText(event.at) }}</span>
      </div>
      <div class="pec-stats">
        <div v-for="item in stats" :key="item.label" class="pec-stat" :class="item.tone">
          <b>{{ item.value }}</b>
          <span>{{ item.label }}</span>
        </div>
      </div>
      <div v-if="event.headline" class="pec-note">{{ event.headline }}</div>
      <div v-if="event.note" class="pec-warn">{{ event.note }}</div>
    </template>

    <!-- 字段决策明细 -->
    <template v-else-if="type === 'field_decisions'">
      <div class="pec-head">
        <span class="pec-kind">决策</span>
        <span class="pec-title">{{ event.title || "字段决策明细" }}</span>
        <span class="spacer"></span>
        <span v-if="event.selected != null" class="pec-meta">已选 {{ event.selected }} / {{ rows.length }}</span>
      </div>
      <div class="pec-dec-table">
        <button
          v-for="row in visibleRows"
          :key="row.targetField"
          type="button"
          class="pec-dec-row"
          :class="{ off: row.selected === false }"
          @click="toggleRow(row.targetField)"
        >
          <div class="pec-dec-main">
            <span class="mono pec-strong">{{ row.targetField }}</span>
            <span class="pec-tag" :class="row.tone">{{ row.decisionLabel }}</span>
            <span class="pec-dec-std">{{ row.standard }}</span>
          </div>
          <div class="pec-dec-sub">
            <span>{{ row.mapping }}</span>
            <span v-if="row.dictionary"> · 字典 {{ row.dictionary }}</span>
            <span v-if="row.confidence < 0.7" class="pec-warn"> · 低置信 {{ Math.round(row.confidence * 100) }}%</span>
          </div>
          <div v-if="expandedRow === row.targetField" class="pec-dec-detail">
            <p v-if="row.targetLabel">目标：{{ row.targetLabel }}</p>
            <p v-if="row.reason">理由：{{ row.reason }}</p>
            <p v-if="row.ruleReason">规则用途：{{ row.ruleReason }}</p>
            <p v-if="row.mappingDetail">映射：{{ row.mappingDetail }}</p>
            <p v-if="row.standardFieldLabel">标准字段：{{ row.standardFieldLabel }}</p>
          </div>
        </button>
      </div>
      <p v-if="!rows.length" class="pec-note">本组没有字段决策。</p>
      <div v-if="rows.length > 8" class="pec-foot">
        <button type="button" class="pec-link" @click="expandedAll = !expandedAll">{{ expandedAll ? "收起部分字段" : "展开全部 " + rows.length + " 个字段" }}</button>
      </div>
    </template>

    <!-- 质量检查 -->
    <template v-else-if="type === 'review'">
      <div class="pec-head">
        <span class="pec-kind">检查</span>
        <span class="pec-title">{{ event.title || "质量检查" }}</span>
        <span class="spacer"></span>
        <span v-if="errorCount" class="pec-tag rose">阻断 {{ errorCount }}</span>
        <span v-if="warningCount" class="pec-tag amber">提示 {{ warningCount }}</span>
      </div>
      <div v-for="finding in visibleFindings" :key="finding.id || finding.code + ':' + finding.targetField" class="pec-finding">
        <div class="pec-finding-head">
          <span class="pec-tag" :class="finding.severity === 'error' ? 'rose' : 'amber'">{{ finding.severity === "error" ? "阻断" : "提示" }}</span>
          <span class="mono">{{ finding.targetField || "本组" }}</span>
          <span class="spacer"></span>
          <span class="pec-dim">{{ finding.code }}</span>
        </div>
        <div class="pec-finding-body">
          <div>{{ finding.message }}</div>
          <div v-if="finding.suggestedAction" class="pec-note">建议：{{ finding.suggestedAction }}</div>
        </div>
        <button
          v-if="finding.suggestedAction && !readOnly && !loading"
          type="button"
          class="pec-btn"
          @click="action('apply-finding', { finding })"
        >按建议调整</button>
      </div>
      <div v-if="findings.length > 5 && !open" class="pec-foot">
        <button type="button" class="pec-link" @click="open = true">显示全部 {{ findings.length }} 条</button>
      </div>
      <div v-if="fixableCount && !readOnly && !loading" class="pec-actions">
        <button type="button" class="pec-btn primary" @click="action('fix-all')">修复全部问题</button>
      </div>
    </template>

    <!-- 冲突 -->
    <template v-else-if="type === 'conflict'">
      <div class="pec-head">
        <span class="pec-kind">确认</span>
        <span class="pec-title">需要你决定</span>
        <span class="spacer"></span>
        <span class="pec-tag rose">{{ conflicts.length }}</span>
      </div>
      <div v-for="(conflict, index) in conflicts" :key="index" class="pec-conflict-row">
        <div>
          <b>{{ conflict.type || conflict.code || "冲突" }}</b>
          <span v-if="conflict.targetField" class="mono"> · {{ conflict.targetField }}</span>
        </div>
        <div>{{ conflict.message || conflict.code }}</div>
      </div>
      <div v-if="!readOnly" class="pec-actions">
        <button type="button" class="pec-btn primary" :disabled="loading" @click="action('approve')">批准模型建议</button>
        <button type="button" class="pec-btn" :disabled="loading" @click="action('keep')">保留我的约束</button>
      </div>
    </template>

    <!-- 人工审批 -->
    <template v-else-if="type === 'approval'">
      <div class="pec-head">
        <span class="pec-kind">审批</span>
        <span class="pec-title">{{ event.title || "当前建议需要人工确认" }}</span>
      </div>
      <div v-if="event.text" class="pec-note">{{ event.text }}</div>
      <div v-if="!readOnly" class="pec-actions">
        <button type="button" class="pec-btn primary" :disabled="loading" @click="action('approve')">批准模型建议</button>
        <button type="button" class="pec-btn" :disabled="loading" @click="action('keep')">保留当前草稿</button>
      </div>
    </template>

    <!-- 差异 -->
    <template v-else-if="type === 'diff'">
      <div class="pec-head">
        <span class="pec-kind">差异</span>
        <span class="pec-title">{{ event.title || "与上一版比较" }}</span>
        <span class="spacer"></span>
        <button type="button" class="pec-link" @click="open = !open">{{ open ? "收起" : "逐条查看" }}</button>
      </div>
      <div class="pec-chips">
        <span v-for="group in diffGroups" :key="group.key" class="pec-chip">{{ group.label }} {{ group.items.length }}</span>
      </div>
      <div v-if="open" class="pec-diff-lists">
        <div v-for="group in diffGroups" :key="'list-' + group.key" class="pec-diff-group">
          <div class="pec-dim">{{ group.label }}</div>
          <div class="mono">{{ group.items.join("、") }}</div>
        </div>
      </div>
    </template>

    <!-- 最终结果 -->
    <template v-else-if="type === 'result'">
      <div class="pec-head">
        <span class="pec-kind">完成</span>
        <span class="pec-title">{{ event.title || "配置建议已生成" }}</span>
        <span class="spacer"></span>
        <span v-if="event.at" class="pec-time">{{ timeText(event.at) }}</span>
      </div>
      <div v-if="stats.length" class="pec-stats">
        <div v-for="item in stats" :key="item.label" class="pec-stat" :class="item.tone">
          <b>{{ item.value }}</b>
          <span>{{ item.label }}</span>
        </div>
      </div>
      <div v-if="event.text" class="pec-note">{{ event.text }}</div>
      <div class="pec-actions">
        <button v-if="event.hasDiff" type="button" class="pec-btn" @click="action('focus-diff')">查看差异</button>
        <button type="button" class="pec-btn" @click="action('copy-result')">复制结果</button>
        <button type="button" class="pec-btn" :disabled="readOnly || loading" @click="action('regenerate')">重新生成</button>
        <button type="button" class="pec-btn primary" :disabled="readOnly || loading || !event.canApply" @click="action('apply-group')">确认本组并应用</button>
      </div>
    </template>

    <!-- 错误 -->
    <template v-else-if="type === 'error'">
      <div class="pec-head">
        <span class="pec-kind">失败</span>
        <span class="pec-title">{{ event.title || "处理失败" }}</span>
      </div>
      <div class="pec-error-text">{{ event.text || "未知错误" }}</div>
      <div class="pec-actions">
        <button type="button" class="pec-btn" :disabled="readOnly || loading" @click="action('retry')">重试</button>
      </div>
    </template>

    <!-- 其他 -->
    <template v-else>
      <div class="pec-head">
        <span class="pec-kind">助手</span>
        <span class="pec-title">{{ event.title }}</span>
      </div>
      <div v-if="event.text" class="pec-rich" v-html="html"></div>
    </template>
  </div>
</template>

<style scoped>
.pec { padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fbfcfe; font-size: 11.5px; line-height: 1.6; color: #334155; }
.pec-head { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; min-width: 0; }
.pec-head .spacer { flex: 1; }
.pec-kind { flex: 0 0 auto; padding: 0 5px; border-radius: 4px; background: #eef2f7; color: #475569; font-size: 9.5px; font-weight: 650; line-height: 17px; }
.pec-title { min-width: 0; color: #1e293b; font-size: 11.5px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pec-time { flex: 0 0 auto; color: #94a3b8; font-size: 9px; }
.pec-icon { border: 0; background: transparent; color: #94a3b8; font-size: 9.5px; cursor: pointer; padding: 0 2px; }
.pec-icon:hover { color: #14533e; }
.pec-meta { color: #94a3b8; font-size: 9.5px; }
.pec-dim { color: #94a3b8; font-size: 9.5px; }
.pec-strong { color: #0f172a; font-weight: 600; }
.pec-note { margin-top: 3px; color: #64748b; font-size: 10.5px; }
.pec-warn { color: #92400e; font-size: 10px; }
.pec-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.pec-tag { display: inline-flex; align-items: center; padding: 0 5px; border-radius: 4px; font-size: 9.5px; font-weight: 600; line-height: 16px; white-space: nowrap; }
.pec-tag.mint { background: #ebf5f1; color: #14533e; }
.pec-tag.blue { background: #eff6ff; color: #1d4ed8; }
.pec-tag.amber { background: #fffbeb; color: #92400e; }
.pec-tag.violet { background: #f5f3ff; color: #6d28d9; }
.pec-tag.gray { background: #f1f5f9; color: #475569; }
.pec-tag.rose { background: #ffe4e6; color: #be123c; }
.pec-conf { color: #14533e; font-size: 10px; font-weight: 600; }
.pec-conf.low { color: #92400e; }
.pec-bar { height: 5px; margin: 5px 0 3px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
.pec-bar i { display: block; height: 100%; border-radius: 999px; background: #19614a; transition: width .2s; }
.pec-lines { margin: 5px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.pec-lines li { display: flex; align-items: flex-start; gap: 5px; color: #475569; font-size: 10.5px; line-height: 1.5; word-break: break-word; }
.pec-line-dot { flex: 0 0 5px; width: 5px; height: 5px; margin-top: 5px; border-radius: 50%; background: #cbd5e1; }
.pec-lines li.status .pec-line-dot { background: #94a3b8; }
.pec-lines li.decision .pec-line-dot { background: #19614a; }
.pec-lines li.field .pec-line-dot { background: #1d4ed8; }
.pec-lines li.mapping .pec-line-dot { background: #64748b; }
.pec-lines li.dictionary .pec-line-dot { background: #6d28d9; }
.pec-spinner { flex: 0 0 auto; width: 10px; height: 10px; border: 1.5px solid #cbe2d7; border-top-color: #19614a; border-radius: 50%; animation: pec-spin .8s linear infinite; }
@keyframes pec-spin { to { transform: rotate(360deg); } }
.pec-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin-top: 2px; }
.pec-stat { display: flex; flex-direction: column; gap: 0; padding: 4px 6px; border-radius: 6px; background: #f1f5f9; }
.pec-stat b { color: #0f172a; font-size: 13px; line-height: 1.25; }
.pec-stat span { color: #64748b; font-size: 9px; }
.pec-stat.mint { background: #ebf5f1; }
.pec-stat.mint b { color: #14533e; }
.pec-stat.blue { background: #eff6ff; }
.pec-stat.blue b { color: #1d4ed8; }
.pec-stat.amber { background: #fffbeb; }
.pec-stat.amber b { color: #92400e; }
.pec-stat.violet { background: #f5f3ff; }
.pec-stat.violet b { color: #6d28d9; }
.pec-stat.rose { background: #ffe4e6; }
.pec-stat.rose b { color: #be123c; }
.pec-dec-table { display: flex; flex-direction: column; gap: 3px; margin-top: 3px; }
.pec-dec-row { display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 5px 6px; border: 1px solid #eef2f7; border-radius: 6px; background: #fff; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.pec-dec-row:hover { border-color: #d7e5de; background: #f7fbf9; }
.pec-dec-row.off { opacity: .5; }
.pec-dec-main { display: flex; align-items: center; gap: 5px; min-width: 0; }
.pec-dec-main .mono { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pec-dec-std { min-width: 0; margin-left: auto; color: #94a3b8; font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pec-dec-sub { color: #64748b; font-size: 9.5px; word-break: break-word; }
.pec-dec-detail { margin-top: 4px; padding-top: 4px; border-top: 1px dashed #e2e8f0; color: #475569; font-size: 10px; }
.pec-dec-detail p { margin: 0 0 2px; }
.pec-finding { padding: 5px 0; border-top: 1px dashed #e2e8f0; }
.pec-finding:first-of-type { border-top: 0; padding-top: 2px; }
.pec-finding-head { display: flex; align-items: center; gap: 5px; }
.pec-finding-head .spacer { flex: 1; }
.pec-finding-body { margin-top: 2px; color: #475569; font-size: 10.5px; }
.pec-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.pec-btn { height: 24px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; color: #475569; font-size: 10.5px; cursor: pointer; }
.pec-btn:hover:not(:disabled) { border-color: #cbe2d7; background: #ebf5f1; color: #14533e; }
.pec-btn.primary { border-color: #19614a; background: #19614a; color: #fff; }
.pec-btn.primary:hover:not(:disabled) { background: #144f3c; color: #fff; }
.pec-btn:disabled { opacity: .5; cursor: not-allowed; }
.pec-link { padding: 0; border: 0; background: transparent; color: #14533e; font-size: 10px; cursor: pointer; }
.pec-link.inline { margin-left: 4px; }
.pec-link:hover { text-decoration: underline; }
.pec-foot { margin-top: 4px; }
.pec-plan-list { margin: 2px 0 0; padding-left: 16px; color: #475569; font-size: 10.5px; }
.pec-plan-list li { margin: 1px 0; }
.pec-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pec-chip { padding: 1px 6px; border-radius: 4px; background: #eff6ff; color: #1e3a8a; font-size: 9.5px; }
.pec-diff-lists { margin-top: 5px; display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow: auto; }
.pec-diff-group { padding: 4px 6px; border-radius: 6px; background: #fff; border: 1px solid #eef2f7; font-size: 10px; word-break: break-word; }
.pec-conflict-row + .pec-conflict-row { margin-top: 4px; }
.pec-conflict-row { color: #9f1239; font-size: 10.5px; }
.pec-approval, .pec-conflict { border-color: #fecdd3; background: #fff1f2; color: #9f1239; }
.pec-approval .pec-note, .pec-conflict .pec-note { color: #9f1239; }
.pec-review { border-color: #fde68a; background: #fffdf5; }
.pec-error { border-color: #fecdd3; background: #fff1f2; }
.pec-error-text { color: #9f1239; font-size: 10.5px; word-break: break-word; }
.pec-result { border-color: #cbe2d7; background: #f2fbf7; }
.pec-decision_summary { border-color: #cbe2d7; background: #f7fcfa; }
.pec-intent { border-color: #bfdbfe; background: #f5f9ff; }
.pec-plan { border-color: #e2e8f0; background: #fbfcfe; }
.pec-stage { background: #fafbfc; }
.pec-user { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; padding: 0; border: 0; background: transparent; }
.pec-user-bubble { max-width: 92%; padding: 7px 10px; border-radius: 10px 10px 3px 10px; background: #e8f1fb; color: #1e3a5f; font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.pec-user-meta { display: flex; align-items: center; gap: 3px; color: #94a3b8; font-size: 9px; }
.pec-dot { color: #cbd5e1; }
.pec-assistant_answer { background: #fff; }
.pec-streaming { margin-top: 3px; color: #94a3b8; font-size: 9.5px; }
.pec-rich :deep(p) { margin: 0 0 4px; }
.pec-rich :deep(ul) { margin: 0 0 4px; padding-left: 16px; }
.pec-rich :deep(li) { margin: 1px 0; }
.pec-rich :deep(strong) { color: #0f172a; font-weight: 650; }
.pec-rich :deep(.md-h) { margin: 6px 0 3px; color: #14533e; }
.pec-rich :deep(.md-code) { margin: 4px 0; padding: 6px 8px; border-radius: 6px; background: #f1f5f9; color: #334155; font-size: 10px; white-space: pre-wrap; }
.pec-rich :deep(.md-table) { width: 100%; margin: 4px 0; border-collapse: collapse; font-size: 10px; }
.pec-rich :deep(.md-table th), .pec-rich :deep(.md-table td) { padding: 3px 6px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
.pec-rich :deep(.md-table th) { background: #f8fafc; color: #475569; }
.pec-rich :deep(hr) { margin: 6px 0; border: 0; border-top: 1px solid #e2e8f0; }
</style>
