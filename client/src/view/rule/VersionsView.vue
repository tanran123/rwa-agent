<script setup>
import { computed, ref } from "vue";
import { fetchRuleVersions } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";

const { session } = useContext();
const jur = ref("");
const status = ref("");
const q = ref("");
const picked = ref(null);
const load = () => fetchRuleVersions(jur.value);
const labels = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };
const tones = { draft: "muted", reviewing: "warn", published: "ok", superseded: "muted", disabled: "danger" };

const jurLabel = (code) => (session.jurisdictions.find((item) => item.code === code) || {}).label || code;

function shown(rows) {
  const word = q.value.trim();
  return (rows || []).filter((row) => {
    if (status.value && labels[row.status] !== status.value && row.status !== status.value) return false;
    if (!word) return true;
    return (row.version + row.name).includes(word);
  });
}

function open(row) {
  picked.value = row;
  session.versionId = row.id;
  session.jurisdiction = row.jurisdiction;
}
</script>

<template>
  <AsyncView :key="jur" :load="load">
    <template #default="{ data }">
      <div class="panel">
        <div class="panel-head">
          <h3>监管规则版本列表</h3>
          <span class="sub">共 {{ data.length }} 个版本</span>
        </div>
        <div class="panel-body">
          <div class="inline-fields" style="margin-bottom: 12px">
            <label class="field">司法管辖区
              <select v-model="jur">
                <option value="">全部地区</option>
                <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
              </select>
            </label>
            <label class="field">规则状态
              <select v-model="status">
                <option value="">全部状态</option>
                <option v-for="(label, key) in labels" :key="key" :value="label">{{ label }}</option>
              </select>
            </label>
            <label class="field" style="flex: 1">关键字
              <input v-model="q" type="search" placeholder="搜索版本编号或规则名称…" />
            </label>
          </div>
          <table class="tbl compact">
            <thead>
              <tr><th>司法管辖区</th><th>版本编号</th><th>规则名称</th><th>规则类型</th><th>生效日期</th><th>适用机构</th><th>状态</th><th>维护人</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in shown(data)" :key="row.id" class="clickable" :class="{ sel: session.versionId === row.id }" @click="picked = row">
                <td>{{ jurLabel(row.jurisdiction) }}</td>
                <td class="mono">{{ row.version }}</td>
                <td>{{ row.name }}</td>
                <td>{{ row.ruleType }}</td>
                <td>{{ row.effectiveFrom }}{{ row.effectiveTo ? " 至 " + row.effectiveTo : " 起" }}</td>
                <td>{{ row.institution }}</td>
                <td><span class="tag" :class="tones[row.status]">{{ labels[row.status] || row.status }}</span></td>
                <td>{{ row.author }}</td>
                <td><button type="button" class="btn sm" @click.stop="open(row)">打开</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div v-if="picked" class="panel">
        <div class="panel-head"><h3>版本详情 · {{ picked.version }}</h3></div>
        <div class="panel-body">
          <p>规则名称 {{ picked.name }} · {{ jurLabel(picked.jurisdiction) }} · {{ picked.institution }}</p>
          <p>生效 {{ picked.effectiveFrom }}<span v-if="picked.effectiveTo">，失效 {{ picked.effectiveTo }}</span></p>
          <p class="dim">{{ picked.changelog }}</p>
        </div>
      </div>
    </template>
  </AsyncView>
</template>
