<script setup>
import { computed, onMounted, ref } from "vue";
import {
  demo, deleteList, downloadBlob, inspectUpload, listHits, listMeta, parseUpload, readFileBase64, saveList
} from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({ task: Object, result: Object, reload: Function });

const meta = ref({ defs: [], templates: {} });
const coverage = ref({});
const busy = ref(false);
const error = ref("");
const currentCode = ref("");
const singleInput = ref(null);
const batchInput = ref(null);
const batch = ref(null);

const lists = computed(() => props.task.lists || {});
const loadedCount = computed(() => meta.value.defs.filter((d) => ((lists.value[d.code] || {}).rows || []).length).length);
const securities = computed(() => ((props.result && props.result.rows) || []).filter((r) => !r.isAdjustment));

const MATCH_LABEL = { secId: "证券代码", isin: "ISIN", issuer: "发行人名称" };

function count(code) {
  return ((lists.value[code] || {}).rows || []).length;
}

function idBased(def) {
  return (def.match || []).some((m) => m === "secId" || m === "isin");
}

async function refreshCoverage() {
  const next = {};
  for (const def of meta.value.defs) {
    if (!count(def.code)) continue;
    try {
      const hit = await listHits(props.task.id, def.code);
      next[def.code] = hit.count;
    } catch (err) {
      next[def.code] = null;
    }
  }
  coverage.value = next;
}

async function bootstrap() {
  meta.value = await listMeta();
  await refreshCoverage();
}

function pickSingle(code) {
  currentCode.value = code;
  singleInput.value.click();
}

async function onSingle(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    const content = await readFileBase64(file);
    const info = await inspectUpload({ kind: "list", filename: file.name, content });
    const sheet = info.sheets.slice().sort((a, b) => b.matrix.length - a.matrix.length)[0];
    const parsed = await parseUpload({ kind: "list", matrix: sheet.matrix });
    if (!parsed.rows.length) throw new Error("未识别到有效行（需包含 证券代码 / ISIN / 发行人 之一）");
    await saveList(props.task.id, currentCode.value, { rows: parsed.rows });
    await props.reload();
    await refreshCoverage();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    event.target.value = "";
  }
}

async function onBatch(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  busy.value = true;
  error.value = "";
  try {
    const content = await readFileBase64(file);
    const info = await inspectUpload({ kind: "list", filename: file.name, content });
    batch.value = {
      sheets: info.sheets.filter((s) => s.matrix.length > 1).map((s) => ({
        ...s,
        target: guessType(s.name, s.det.map || {})
      }))
    };
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
    event.target.value = "";
  }
}

function guessType(sheetName, map) {
  const name = String(sheetName).toLowerCase();
  const has = (key) => map[key] != null;
  if (has("ltv") || has("approved") || /rmbs|按揭|mortgage/.test(name)) return "rmbs_approval";
  if (has("secId") || has("isin")) {
    if (/回购|质押|repo|pledge|占用|encumber/.test(name)) return "encumbered";
    if (/次级|结构|subordinat|structured|永续/.test(name)) return "structured_sub";
    return "trading_book";
  }
  if (has("issuer")) {
    if (/政策|policy/.test(name)) return "policy_bank";
    if (/本行|自有|own/.test(name)) return "own_issue";
    return "related_party";
  }
  return "";
}

async function confirmBatch() {
  busy.value = true;
  try {
    let total = 0;
    for (const sheet of batch.value.sheets) {
      if (!sheet.target) continue;
      const parsed = await parseUpload({ kind: "list", matrix: sheet.matrix });
      if (!parsed.rows.length) continue;
      await saveList(props.task.id, sheet.target, { rows: parsed.rows });
      total += parsed.rows.length;
    }
    batch.value = null;
    await props.reload();
    await refreshCoverage();
    error.value = total ? "" : "没有可导入的清单";
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function downloadTemplate(def) {
  const csv = meta.value.templates[def.code];
  if (!csv) {
    error.value = "该清单无模板";
    return;
  }
  downloadBlob(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }), `清单模板_${def.label}.csv`);
}

async function clearOne(def) {
  await deleteList(props.task.id, def.code);
  await props.reload();
  await refreshCoverage();
}

async function clearAll() {
  const ok = await askConfirm("将清空该任务下已导入的全部内部清单，确定继续？", { title: "清空全部清单", danger: true });
  if (!ok) return;
  for (const code of Object.keys(lists.value)) await deleteList(props.task.id, code);
  await props.reload();
  await refreshCoverage();
}

async function loadDemo() {
  busy.value = true;
  try {
    const data = await demo("lists");
    for (const [code, value] of Object.entries(data.lists || {})) {
      if (!meta.value.defs.some((d) => d.code === code)) continue;
      await saveList(props.task.id, code, { rows: value.rows || [] });
    }
    await props.reload();
    await refreshCoverage();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

onMounted(bootstrap);
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>② 导入内部基础参数清单</h3>
      <span class="sub">已载入 {{ loadedCount }} / {{ meta.defs.length }} 类</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" :disabled="busy" @click="batchInput.click()">批量导入（多表工作簿）</button>
      <button type="button" class="btn sm" @click="clearAll">全部清空</button>
      <input ref="singleInput" type="file" accept=".xlsx,.xlsm,.csv,.tsv" style="display: none" @change="onSingle" />
      <input ref="batchInput" type="file" accept=".xlsx,.xlsm" style="display: none" @change="onBatch" />
    </div>
    <div class="panel-body tight">
      <table class="tbl compact">
        <thead><tr><th>清单</th><th>匹配键</th><th>状态 / 覆盖</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="def in meta.defs" :key="def.code">
            <td>
              <div style="font-weight: 500">{{ def.label }}</div>
              <div class="dim" style="font-size: 10.5px">{{ def.note }}</div>
            </td>
            <td class="dim" style="font-size: 11px">{{ (def.match || []).map((m) => MATCH_LABEL[m] || m).join(" / ") }}</td>
            <td>
              <template v-if="count(def.code)">
                <span class="tag ok">{{ count(def.code) }} 条</span>
                <span class="dim" style="font-size: 10.5px; margin-left: 6px">
                  {{ coverage[def.code] == null ? "" : `命中明细 ${coverage[def.code]} / ${securities.length} 笔` }}
                </span>
                <div v-if="coverage[def.code] === 0" class="dim" style="font-size: 10.5px; margin-top: 2px" :style="{ color: idBased(def) ? 'var(--warn)' : 'var(--ink-3)' }">
                  {{ idBased(def) ? "⚠ 未命中任何一笔，建议核对证券代码 / ISIN" : "未命中（本任务内无此类发行人，属正常）" }}
                </div>
              </template>
              <template v-else>
                <span class="tag muted">未载入</span>
                <div class="dim" style="font-size: 10.5px; margin-top: 2px">未提供，后续判定中该项将标记为「未执行」</div>
              </template>
            </td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap">
                <button type="button" class="btn sm" :disabled="busy" @click="pickSingle(def.code)">上传</button>
                <button type="button" class="btn sm" @click="downloadTemplate(def)">模板</button>
                <button type="button" class="btn sm danger" :disabled="!count(def.code)" @click="clearOne(def)">清空</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="dim" style="font-size: 11px; margin-top: 8px; line-height: 1.7">
        未载入的清单不会阻断流程，但后续判定中相关项目会标记为「未执行」，并在结论中单独列出。
      </p>
    </div>
  </div>

  <div v-if="batch" class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>批量导入 · 按工作表分派清单类型</h3>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="batch = null">取消</button>
      <button type="button" class="btn sm primary" :disabled="busy" @click="confirmBatch">确认导入</button>
    </div>
    <div class="panel-body tight">
      <table class="tbl compact">
        <thead><tr><th>工作表</th><th class="num">行数</th><th>导入为</th></tr></thead>
        <tbody>
          <tr v-for="sheet in batch.sheets" :key="sheet.name">
            <td>{{ sheet.name }}</td>
            <td class="num">{{ sheet.matrix.length }}</td>
            <td>
              <select v-model="sheet.target">
                <option value="">（不导入）</option>
                <option v-for="def in meta.defs" :key="def.code" :value="def.code">{{ def.label }}</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h3>演示数据</h3><span class="sub">仅用于功能演示，不代表真实业务数据</span></div>
    <div class="panel-body">
      <button type="button" class="btn sm" :disabled="busy" @click="loadDemo">载入演示清单</button>
    </div>
  </div>
</template>
