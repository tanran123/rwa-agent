<script setup>
import { computed, ref } from "vue";
import { planSample, saveConfig, saveSample } from "@/api/hqla";
import { askConfirm } from "@/utils/confirm";

const props = defineProps({ task: Object, result: Object, reload: Function });

const busy = ref(false);
const error = ref("");

const ATTR = {
  "lower|relying": [4, 16, 30],
  "lower|none": [14, 34, 54],
  "higher|relying": [10, 28, 46],
  "higher|none": [30, 57, 83]
};

function sourceCfg() {
  const result = props.result || {};
  return result.cfgSnapshot || result.cfg || props.task.cfg || {};
}

const sampling = computed(() => {
  const cfg = sourceCfg();
  return cfg.sampling || { mode: "full", risk: "higher", reliance: "none", expectedDeviations: 0, fixedSize: 15, seed: 20251231, stratify: true };
});

const baseRows = computed(() => (props.result && props.result.rows) || []);
const sampleable = computed(() => baseRows.value.filter((r) => !r.isAdjustment).length);
const matched = computed(() => baseRows.value.filter((r) => !r.isAdjustment && r.ref).length);
const manual = computed(() => baseRows.value.filter((r) => r.isAdjustment).length);
const sample = computed(() => props.task.sample);
const cfgSig = computed(() => JSON.stringify(sampling.value));
const stale = computed(() => !!(sample.value && sample.value.cfgSig && sample.value.cfgSig !== cfgSig.value));

const attrRow = computed(() => ATTR[`${sampling.value.risk}|${sampling.value.reliance}`] || [4, 16, 30]);

async function patch(patchValue) {
  const cfg = JSON.parse(JSON.stringify(sourceCfg()));
  cfg.sampling = { ...(cfg.sampling || {}), ...patchValue };
  await saveConfig(props.task.id, cfg);
  await props.reload();
}

async function generate() {
  if (!baseRows.value.length) {
    error.value = "请先导入债券明细";
    return;
  }
  if (props.task.fetchLog && props.task.fetchLog.length) {
    const ok = await askConfirm(`重新抽样将清空第 5 步已抓取的 ${props.task.fetchLog.length} 笔外部取数日志（外部参考库本身不受影响）。确定重新生成？`, { title: "重新生成样本" });
    if (!ok) return;
  }
  busy.value = true;
  error.value = "";
  try {
    const plan = await planSample(props.task.id);
    await saveSample(props.task.id, {
      indices: plan.indices,
      size: plan.size,
      universe: plan.universe,
      method: plan.method,
      seed: plan.seed,
      strata: plan.strata,
      coverage: plan.coverage,
      cfgSig: cfgSig.value,
      at: new Date().toISOString().replace("T", " ").slice(0, 19)
    });
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function levelText(code) {
  return { L1: "Level 1", L2A: "Level 2A", L2B: "Level 2B", NA: "不合格", UNK: "未识别" }[code] || code;
}

function downloadCsv() {
  const rows = (props.result && props.result.sampleRows) || [];
  const lines = [["序号", "证券代码", "债券名称", "申报档位", "币种组", "金额(HKD)", "外部信息匹配"].join(",")];
  rows.forEach((row, i) => {
    lines.push([
      i + 1, row.secId,
      `"${String((row.ref && row.ref.name) || "").replace(/"/g, '""')}"`,
      row.itemRaw || "", row.ccyGroup || "", row.amount == null ? "" : row.amount,
      row.ref ? row.matchBy || "命中" : "未命中"
    ].join(","));
  });
  const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `抽样清单_${sample.value ? sample.value.seed : ""}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel" style="margin-bottom: 12px">
    <div class="panel-head">
      <h3>④ 抽样策略</h3>
      <span class="spacer"></span>
      <button type="button" class="btn sm primary" :disabled="busy" @click="generate">{{ sample ? "重新生成样本" : "生成样本清单" }}</button>
    </div>
    <div class="panel-body">
      <div class="grid c3" style="margin-bottom: 12px">
        <div
          v-for="mode in [['full', '100', '全量检查', '对全部证券逐笔判定（100% 覆盖）'], ['attribute', 'A', '属性抽样', '按 AAM 23005A.1 样本量表确定样本量'], ['fixed', 'N', '固定样本量', '由审计人员直接指定样本笔数']]"
          :key="mode[0]"
          class="panel"
          style="cursor: pointer; padding: 10px"
          :style="sampling.mode === mode[0] ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)' } : null"
          @click="patch({ mode: mode[0] })"
        >
          <div style="font-weight: 600">{{ mode[2] }}</div>
          <div class="dim" style="font-size: 11px">{{ mode[3] }}</div>
        </div>
      </div>

      <div class="grid c4">
        <div v-if="sampling.mode === 'attribute'">
          <label class="field">
            <span>风险水平</span>
            <select :value="sampling.risk" @change="patch({ risk: $event.target.value })">
              <option value="lower">较低风险</option>
              <option value="higher">较高风险</option>
            </select>
          </label>
          <label class="field">
            <span>控制依赖</span>
            <select :value="sampling.reliance" @change="patch({ reliance: $event.target.value })">
              <option value="none">不依赖控制</option>
              <option value="relying">依赖控制</option>
            </select>
          </label>
          <label class="field">
            <span>预计偏差数</span>
            <select :value="String(sampling.expectedDeviations)" @change="patch({ expectedDeviations: Number($event.target.value) })">
              <option v-for="d in [0, 1, 2]" :key="d" :value="String(d)">预计偏差 {{ d }}</option>
            </select>
          </label>
          <div class="dim" style="font-size: 10.5px; margin-bottom: 4px">
            AAM 23005A.1 · {{ sampling.risk === "higher" ? "较高风险" : "较低风险" }} · {{ sampling.reliance === "relying" ? "依赖控制" : "不依赖控制" }}
          </div>
          <table class="tbl compact">
            <tbody>
              <tr v-for="(n, i) in attrRow" :key="i" :style="i === Number(sampling.expectedDeviations) ? { background: 'var(--brand-soft)', fontWeight: 600 } : null">
                <td>预计偏差 {{ i }}</td><td class="num">{{ n }} 笔</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="sampling.mode === 'fixed'">
          <label class="field">
            <span>样本量（笔）</span>
            <input type="number" :value="sampling.fixedSize" @change="patch({ fixedSize: Number($event.target.value) || 1 })" />
          </label>
          <div class="dim" style="font-size: 11px">当前总体 {{ sampleable }} 行</div>
        </div>
        <div>
          <label class="field">
            <span>随机种子（保证可复现）</span>
            <input type="number" :value="sampling.seed" @change="patch({ seed: Number($event.target.value) || 1 })" />
          </label>
          <label class="checkline">
            <input type="checkbox" :checked="sampling.stratify !== false" @change="patch({ stratify: $event.target.checked })" />
            <span>按申报档位分层并按比例分配</span>
          </label>
        </div>
        <div>
          <label class="field">
            <span>抽样基数</span>
            <select :value="sampling.filterLevel || 'ALL'" @change="patch({ filterLevel: $event.target.value })">
              <option value="ALL">全部申报档位</option>
              <option value="L1">仅 Level 1</option>
              <option value="L2A">仅 Level 2A</option>
              <option value="L2B">仅 Level 2B</option>
            </select>
          </label>
          <div class="dim" style="font-size: 10.5px">手工调整行（如回购扣减）始终不参与抽样</div>
        </div>
      </div>

      <div class="sum-bar" style="margin-top: 8px">
        <div class="si"><div class="sl">明细行数</div><div class="sv">{{ baseRows.length }}</div></div>
        <div class="si"><div class="sl">可抽样证券</div><div class="sv">{{ sampleable }}</div></div>
        <div class="si"><div class="sl">手工调整行（不参与抽样）</div><div class="sv">{{ manual }}</div></div>
        <div class="si"><div class="sl">已取得外部信息</div><div class="sv">{{ matched }} / {{ sampleable }}</div></div>
      </div>

      <p v-if="stale" class="notice warn" style="margin-top: 10px">
        抽样策略或明细已变更，当前样本可能已过期，请点击「重新生成样本」后再进入下一步。
      </p>
    </div>
  </div>

  <div v-if="sample" class="panel">
    <div class="panel-head">
      <h3>样本清单预览</h3>
      <span class="sub">共 {{ sample.size }} 笔 · {{ sample.method }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm" @click="downloadCsv">导出抽样清单</button>
    </div>
    <div class="panel-body">
      <div class="grid c4" style="margin-bottom: 12px">
        <div class="kpi"><div class="k-label">样本 / 总体</div><div class="k-value">{{ sample.size }} / {{ sample.universe }}</div><div class="k-foot">{{ sample.method }}</div></div>
        <div class="kpi"><div class="k-label">覆盖率</div><div class="k-value">{{ ((sample.coverage || 0) * 100).toFixed(1) }}%</div><div class="k-foot">随机种子 {{ sample.seed }}</div></div>
        <div class="kpi"><div class="k-label">分层</div><div class="k-value sm">{{ (sample.strata || []).map((x) => `${levelText(x.level)} ${x.sample}`).join(" · ") }}</div><div class="k-foot">{{ (sample.strata || []).map((x) => `总体 ${x.population}`).join(" · ") }}</div></div>
        <div class="kpi"><div class="k-label">生成时间</div><div class="k-value sm">{{ String(sample.at || "").slice(5, 16) }}</div><div class="k-foot">修改策略后请重新生成</div></div>
      </div>

      <div style="font-size: 11.5px; font-weight: 600; margin-bottom: 6px">分层构成</div>
      <table class="tbl compact">
        <thead><tr><th>分层</th><th class="num">总体笔数</th><th class="num">抽取笔数</th><th class="num">抽取比例</th></tr></thead>
        <tbody>
          <tr v-for="item in sample.strata || []" :key="item.level">
            <td>{{ levelText(item.level) }}</td>
            <td class="num">{{ item.population }}</td>
            <td class="num">{{ item.sample }}</td>
            <td class="num">{{ item.population ? ((item.sample / item.population) * 100).toFixed(1) + "%" : "—" }}</td>
          </tr>
        </tbody>
      </table>

      <div style="font-size: 11.5px; font-weight: 600; margin: 14px 0 6px">样本明细</div>
      <table class="tbl compact">
        <thead><tr><th class="num">#</th><th>证券代码</th><th>债券名称</th><th>申报档位</th><th class="num">金额(HKD)</th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in (result && result.sampleRows) || []" :key="row.i">
            <td class="num">{{ i + 1 }}</td>
            <td class="mono" style="font-size: 11px">{{ row.secId }}</td>
            <td class="dim" style="font-size: 11px">{{ row.ref ? row.ref.name : "未匹配" }}</td>
            <td>{{ levelText(row.item) }}</td>
            <td class="num">{{ (row.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
