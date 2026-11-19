<script setup>
import { computed } from "vue";

const props = defineProps({ task: Object, meta: Object, reload: Function });

const cfg = computed(() => (props.task && props.task.cfg) || {});
const inherited = computed(() => (props.task && (props.task.rwaTask || cfg.value.rwaTask)) || {});
const sub = computed(() => (props.task && (props.task.rwaTaskSub || cfg.value.rwaTaskSub)) || {});
const snapshot = computed(() => (props.task && props.task.snapshot) || {});
const SIDE_LABEL = { ASSET: "资产端", INFLOW: "现金流入", OUTFLOW: "现金流出" };
const domain = computed(() => cfg.value.domain || "LCR");

const rows = computed(() => [
  ["主任务名称", inherited.value.name || "—"],
  ["子任务名称", sub.value.name || "—"],
  ["监管规则版本", cfg.value.ruleVersion || inherited.value.version || "—"],
  ["机构", inherited.value.institution || props.task.institution || "—"],
  ["司法管辖区", inherited.value.jurisdiction || cfg.value.jurisdiction || "—"],
  ["基准日", inherited.value.baseDate || props.task.baseDate || "—"],
  ["计量期间", inherited.value.baseDate || props.task.baseDate || "—"],
  ["计量领域", domain.value === "LCR" ? "LCR 流动性覆盖率" : domain.value]
]);
</script>

<template>
  <div class="panel">
    <div class="panel-head">
      <h3>基本信息</h3>
      <span class="sub">第 1 步 · 从主任务和流动性子任务继承，LCR 向导内不可修改</span>
      <span class="spacer"></span>
      <span class="tag" :class="snapshot.id ? 'green' : 'amber'">
        {{ snapshot.id ? "快照已锁定" : "快照待生成" }}
      </span>
    </div>
    <div class="panel-body">
      <p v-if="!inherited.id && !inherited.name" class="notice warn">
        这是旧版独立 LCR 任务，没有主任务和子任务来源；建议只读保留，不再新建独立任务。
      </p>
      <div class="grid c2">
        <div v-for="[label, value] in rows" :key="label" class="field">
          <label>{{ label }}</label>
          <div>{{ value }}</div>
        </div>
      </div>
      <p class="dim" style="font-size: 11.5px; margin-top: 10px">
        基本信息、监管版本、机构和基准日由主任务决定；LCR 向导只读取，不重新选择版本。
      </p>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h3>配置快照</h3>
      <span class="sub">计算只读取这份快照</span>
    </div>
    <div class="panel-body">
      <div v-if="snapshot.id" class="kv small">
        <div class="k">快照编号</div><div class="mono">{{ snapshot.id }}</div>
        <div class="k">规则版本</div><div class="mono">{{ snapshot.ruleVersion || cfg.ruleVersion || "—" }}</div>
        <div class="k">哈希</div><div class="mono small">{{ snapshot.hash || "—" }}</div>
        <div class="k">生成时间</div><div>{{ snapshot.createdAt || "—" }}</div>
      </div>
      <p v-else class="dim">首次打开子任务时生成配置快照；生成后产品、字段、字典、规则和参数冻结。</p>
    </div>
  </div>
</template>
