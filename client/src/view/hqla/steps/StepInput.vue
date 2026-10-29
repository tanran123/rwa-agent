<script setup>
import { computed, ref } from "vue";
import {
  demo, inspectUpload, parseUpload, readFileBase64, saveInput, saveReported
} from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({ task: Object, result: Object, reload: Function });

const busy = ref(false);
const error = ref("");
const pending = ref(null);
const fileInput = ref(null);
const reportedInput = ref(null);

const rows = computed(() => (props.task.input && props.task.input.rows) || []);

const MAPPING = [
  ["item", "档位（Level 1 / 2A / 2B）", true],
  ["secId", "证券代码 / ISIN", true],
  ["ccyGroup", "币种 / 币种组", false],
  ["amount", "金额（折港币）", true]
];

const quality = computed(() => {
  const list = rows.value;
  const missAmount = list.filter((r) => r.amount == null || r.amount === 0);
  const unknown = list.filter((r) => r.item === "UNK");
  const noCcy = list.filter((r) => !r.ccyGroupRaw);
  const seen = new Map();
  list.forEach((r) => { if (r.key && r.key.includes("|")) seen.set(r.key, (seen.get(r.key) || 0) + 1); });
  const dup = [...seen.entries()].filter(([, n]) => n > 1);
  const negative = list.filter((r) => (r.amount || 0) < 0);
  return [
    ["金额缺失或为 0", missAmount, "danger", "示例"],
    ["档位无法识别", unknown, "warn", "示例"],
    ["币种 / 币种组缺失", noCcy, "warn", "示例"],
    ["证券代码重复", dup.map(([key, n]) => ({ key, n })), "warn", "代码"],
    ["负值行（如回购扣减）", negative, "info", "示例"]
  ];
});

const total = computed(() => rows.value.reduce((sum, r) => sum + (r.amount || 0), 0));

async function onFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    const content = await readFileBase64(file);
    const info = await inspectUpload({ kind: "input", filename: file.name, content });
    const sheet = info.sheets[info.best] || info.sheets[0];
    pending.value = {
      matrix: sheet.matrix,
      det: sheet.det,
      headerRow: sheet.det.row,
      source: `${file.name} › ${sheet.name}`,
      width: sheet.matrix.reduce((m, r) => Math.max(m, (r || []).length), 0)
    };
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    event.target.value = "";
  }
}

function columnLabel(index) {
  const header = pending.value && pending.value.headerRow >= 0 ? pending.value.matrix[pending.value.headerRow] : [];
  const cell = header[index];
  return cell == null || cell === "" ? `第 ${index + 1} 列` : `第 ${index + 1} 列 · ${String(cell).slice(0, 18)}`;
}

function mapChanged(field, value) {
  const next = { ...pending.value.det, map: { ...pending.value.det.map } };
  if (value === "") delete next.map[field];
  else next.map[field] = Number(value);
  pending.value = { ...pending.value, det: next };
}

async function confirmImport() {
  const map = pending.value.det.map || {};
  if (map.item == null || map.secId == null || map.amount == null) {
    error.value = "请先指定档位、证券代码、金额三列";
    return;
  }
  busy.value = true;
  try {
    const parsed = await parseUpload({ kind: "input", matrix: pending.value.matrix, det: pending.value.det });
    await saveInput(props.task.id, { rows: parsed.rows, meta: { source: pending.value.source, count: parsed.rows.length } });
    pending.value = null;
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function clearInput() {
  const ok = await askConfirm("将清除本任务已导入的明细数据与抽样结果，确定继续？", { title: "清除明细", danger: true });
  if (!ok) return;
  await saveInput(props.task.id, { rows: [], meta: null });
  await props.reload();
}

async function loadDemoInput() {
  busy.value = true;
  try {
    const data = await demo("input");
    await saveInput(props.task.id, { rows: data.rows, meta: data.meta });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function onReported(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    const content = await readFileBase64(file);
    const info = await inspectUpload({ kind: "compilation", filename: file.name, content });
    const sheet = info.sheets.slice().sort((a, b) => b.matrix.length - a.matrix.length)[0];
    const parsed = await parseUpload({ kind: "compilation", matrix: sheet.matrix });
    if (!parsed.rows.length) throw new Error("未识别到申报汇总行（需按档位 × 条款列示本金与加权金额）");
    await saveReported(props.task.id, parsed.rows);
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    event.target.value = "";
  }
}

async function loadDemoReported() {
  const data = await demo("reported");
  await saveReported(props.task.id, data.rows);
  await props.reload();
}

async function clearReported() {
  await saveReported(props.task.id, []);
  await props.reload();
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>① 导入债券明细（全量）</h3>
      <span class="sub">整份清单一次导入，作为本任务的抽样总体</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm primary" :disabled="busy" @click="fileInput.click()">上传文件</button>
      <input ref="fileInput" type="file" accept=".xlsx,.xlsm,.csv,.tsv" style="display: none" @change="onFile" />
    </div>
    <div class="panel-body">
      <div v-if="pending">
        <p class="notice warn">
          已解析到 {{ pending.matrix.length }} 行、{{ pending.width }} 列，请确认下方列映射后再导入。来源：{{ pending.source }}
        </p>
        <div class="grid c4">
          <label v-for="[field, label, required] in MAPPING" :key="field" class="field">
            <span>{{ label }}<b v-if="required" style="color: var(--danger)"> *</b></span>
            <select :value="pending.det.map[field] == null ? '' : String(pending.det.map[field])" @change="mapChanged(field, $event.target.value)">
              <option value="">{{ required ? "（请选择）" : "（不使用）" }}</option>
              <option v-for="i in pending.width" :key="i" :value="String(i - 1)">{{ columnLabel(i - 1) }}</option>
            </select>
          </label>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px">
          <button type="button" class="btn sm primary" :disabled="busy" @click="confirmImport">确认导入</button>
          <button type="button" class="btn sm" @click="pending = null">取消</button>
        </div>
      </div>

      <template v-else-if="rows.length">
        <div class="grid c3" style="margin-bottom: 12px">
          <div class="kpi"><div class="k-label">明细行数</div><div class="k-value">{{ rows.length }}</div><div class="k-foot">{{ (task.input.meta || {}).source || "" }}</div></div>
          <div class="kpi"><div class="k-label">合计金额</div><div class="k-value">{{ total.toLocaleString("zh-CN", { maximumFractionDigits: 0 }) }}</div><div class="k-foot">港元</div></div>
          <div class="kpi"><div class="k-label">可抽样证券</div><div class="k-value">{{ rows.filter((r) => r.key && (r.amount || 0) > 0).length }}</div><div class="k-foot">后续抽样总体</div></div>
        </div>
        <div style="font-size: 11.5px; font-weight: 600; margin-bottom: 6px">数据质量校验</div>
        <table class="tbl compact">
          <thead><tr><th>检查项</th><th>结果</th><th>示例</th></tr></thead>
          <tbody>
            <tr v-for="[label, list, level, hint] in quality" :key="label">
              <td>{{ label }}</td>
              <td><span class="tag" :class="list.length ? level : 'ok'">{{ list.length ? `${list.length} 行` : "通过" }}</span></td>
              <td class="dim" style="font-size: 11px">
                {{ list.length ? `${hint}：${list.slice(0, 3).map((x) => String(x.secId || x.key || "").slice(0, 22)).join("、")}${list.length > 3 ? " …" : ""}` : "—" }}
              </td>
            </tr>
          </tbody>
        </table>
        <div style="font-size: 11.5px; font-weight: 600; margin: 14px 0 6px">明细预览（前 10 行）</div>
        <table class="tbl compact">
          <thead><tr><th>#</th><th>档位</th><th>证券代码 / ISIN</th><th>币种组</th><th class="num">金额(HKD)</th></tr></thead>
          <tbody>
            <tr v-for="row in rows.slice(0, 10)" :key="row.lineNo">
              <td class="num">{{ row.lineNo }}</td>
              <td>{{ row.itemRaw }}</td>
              <td class="mono" style="font-size: 11px">{{ row.secId }}</td>
              <td>{{ row.ccyGroupRaw || "—" }}</td>
              <td class="num">{{ (row.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
            </tr>
          </tbody>
        </table>
        <div style="margin-top: 10px">
          <button type="button" class="btn sm" @click="clearInput">清除并重新导入</button>
        </div>
      </template>

      <div v-else class="empty">
        <div class="ei">⤒</div>
        <div>尚未导入债券明细。支持上传 .xlsx / .csv，导入后可手工确认列映射。</div>
      </div>
    </div>
  </div>

  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>导入客户申报数（可选，供第 7 步对账）</h3>
      <span class="sub">{{ task.reported && task.reported.length ? `已载入 ${task.reported.length} 条` : "未载入" }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="busy" @click="reportedInput.click()">上传申报汇总</button>
      <button v-if="task.reported && task.reported.length" type="button" class="btn sm" @click="clearReported">清除</button>
      <input ref="reportedInput" type="file" accept=".xlsx,.xlsm,.csv,.tsv" style="display: none" @change="onReported" />
    </div>
    <div class="panel-body">
      <div class="dim" style="font-size: 11px; line-height: 1.7">
        {{ task.reported && task.reported.length
          ? `按档位汇总的申报加权金额：${task.reported.reduce((s, r) => s + (r.weightedThousand || 0), 0).toLocaleString("zh-CN")} 千元。将在第 7 步用于逐格对账。`
          : "若有客户申报的加权金额（按档位 × 条款列示），可在此导入；第 7 步会用它做逐格对账。不导入也不影响前面的判定。" }}
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>演示数据</h3><span class="sub">仅用于功能演示，不代表真实业务数据</span></div>
    <div class="panel-body" style="display: flex; gap: 8px">
      <button type="button" class="btn sm" :disabled="busy" @click="loadDemoInput">载入演示明细</button>
      <button type="button" class="btn sm" :disabled="busy" @click="loadDemoReported">载入演示申报数</button>
    </div>
  </div>
</template>
