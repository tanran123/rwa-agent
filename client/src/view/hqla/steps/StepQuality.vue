<script setup>
import { computed, ref } from "vue";
import { checkQuality } from "@/api/hqla";

const props = defineProps({ task: Object, reload: Function });
const busy = ref(false);
const error = ref("");

const datasets = computed(() => (props.task && props.task.datasets) || []);
const checked = computed(() => datasets.value.filter((item) => item.quality));
const blocking = computed(() => checked.value.filter((item) => item.quality.status === "BLOCK").length);
const warnings = computed(() => checked.value.filter((item) => item.quality.status === "WARN").length);
const overall = computed(() => {
  if (!datasets.value.length) return { label: "待导入", tone: "muted" };
  if (checked.value.length < datasets.value.length) return { label: "待检查", tone: "amber" };
  if (blocking.value) return { label: blocking.value + " 项阻断", tone: "red" };
  if (warnings.value) return { label: warnings.value + " 项警告", tone: "amber" };
  return { label: "全部通过", tone: "green" };
});

async function run() {
  busy.value = true;
  error.value = "";
  try {
    await checkQuality(props.task.id);
    await props.reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div class="panel">
    <div class="panel-head">
      <h3>数据质量检查</h3>
      <span class="tag" :class="overall.tone">{{ overall.label }}</span>
      <span class="spacer"></span>
      <button type="button" class="btn sm primary" :disabled="busy || !datasets.length" @click="run">
        {{ busy ? "检查中…" : "执行质量检查" }}
      </button>
    </div>
    <div class="panel-body">
      <p class="dim" style="font-size: 12px; margin: 0 0 10px">
        只围绕本次计量需要的数据检查；规则条件性字段按分支动态判定，不要求产品全部字段完整。
      </p>
      <div v-if="!datasets.length" class="empty">请先在第二步导入 Excel 数据。</div>
      <div v-else class="panel" style="margin: 0">
        <table class="tbl">
          <thead>
            <tr><th>数据集</th><th>检查类型</th><th>检查内容</th><th class="num">记录数</th><th class="num">异常</th><th>结果</th></tr>
          </thead>
          <tbody>
            <template v-for="dataset in datasets" :key="dataset.id">
              <tr v-if="!dataset.quality">
                <td>{{ dataset.sheet }}</td>
                <td colspan="4" class="dim">尚未执行质量检查</td>
                <td><span class="tag muted">待检查</span></td>
              </tr>
              <tr v-for="check in (dataset.quality ? dataset.quality.checks : [])" :key="dataset.id + '-' + check.type">
                <td>{{ dataset.sheet }}</td>
                <td>{{ check.type }}</td>
                <td class="small dim">{{ check.detail }}</td>
                <td class="num mono">{{ check.total }}</td>
                <td class="num mono" :class="{ danger: check.failed }">{{ check.failed }}</td>
                <td>
                  <span class="tag" :class="check.status === 'PASS' ? 'green' : check.status === 'WARN' ? 'amber' : 'red'">
                    {{ check.status === "PASS" ? "通过" : check.status === "WARN" ? "警告（可继续）" : "阻断" }}
                  </span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p class="dim" style="font-size: 11.5px; margin-top: 10px">
        通过 → 可计算；警告 → 记录风险提示；阻断 → 必须修复后才能进入计算。
      </p>
    </div>
  </div>

  <div v-if="checked.length" class="panel">
    <div class="panel-head"><h3>数据集结论</h3><span class="sub">{{ checked.length }} / {{ datasets.length }} 个数据集已检查</span></div>
    <div class="panel-body tight">
      <table class="tbl">
        <thead><tr><th>数据集</th><th>产品</th><th>整体结果</th><th>缺失必需字段</th><th class="num">异常项</th></tr></thead>
        <tbody>
          <tr v-for="dataset in datasets" :key="dataset.id">
            <td>{{ dataset.sheet }}</td>
            <td>{{ dataset.productName || dataset.productCode || "—" }}</td>
            <td>
              <span v-if="dataset.quality" class="tag" :class="dataset.quality.status === 'PASS' ? 'green' : dataset.quality.status === 'WARN' ? 'amber' : 'red'">
                {{ dataset.quality.status === "PASS" ? "通过" : dataset.quality.status === "WARN" ? "警告" : "阻断" }}
              </span>
              <span v-else class="dim">—</span>
            </td>
            <td class="small dim">{{ (dataset.quality && dataset.quality.missingRequired || []).join(", ") || "—" }}</td>
            <td class="num mono">{{ dataset.quality ? (dataset.quality.checks || []).reduce((sum, item) => sum + (item.failed || 0), 0) : "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
