<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createExposureVersion } from "@/api/exposure";
import { createRuleVersion, fetchRuleVersions } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import VersionContext from "@/components/VersionContext.vue";
import { askConfirm } from "@/utils/confirm";
import { CAPITAL_LINKS, LIQUIDITY_LINKS } from "@/utils/ruleLinks";

const route = useRoute();
const router = useRouter();
const { session } = useContext();
const current = ref(null);
const error = ref("");
const creating = ref(false);
const isNew = computed(() => route.params.id === "new");
const form = ref(blankForm());
const formError = ref("");
const saving = ref(false);

const labels = { draft: "草稿", reviewing: "审核中", published: "已发布", superseded: "已被取代", disabled: "已停用" };

function blankForm() {
  const code = session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "");
  const org = session.orgs.find((item) => item.jurisdiction === code);
  return {
    id: "",
    jurisdiction: code,
    version: "",
    name: "",
    ruleType: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "draft",
    institution: org ? org.name : "",
    rulesetFile: "",
    publishedAt: "",
    author: "",
    changelog: ""
  };
}

function alignInstitution() {
  if (!form.value) return;
  const org = session.orgs.find((item) => item.jurisdiction === form.value.jurisdiction);
  form.value.institution = org ? org.name : "";
}

watch(() => session.ready, () => {
  if (!isNew.value || !form.value || form.value.institution) return;
  const org = session.orgs.find((item) => item.jurisdiction === form.value.jurisdiction);
  if (org) form.value.institution = org.name;
});

async function saveNew() {
  if (saving.value || !form.value) return;
  formError.value = "";
  saving.value = true;
  try {
    const saved = await createRuleVersion({ ...form.value });
    router.replace({ name: "version-workbench", params: { id: saved.id } });
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function load() {
  const rows = await fetchRuleVersions();
  const row = rows.find((item) => item.id === route.params.id);
  if (!row) throw new Error("没有找到这个监管规则版本");
  current.value = row;
  return row;
}

function scopeTo(row) {
  session.jurisdiction = row.jurisdiction;
  session.versionId = row.id;
}

function openConfig(row, path) {
  scopeTo(row);
  router.push(path);
}

async function openExposure(row) {
  if (row.exposureCount) {
    openConfig(row, "/tree");
    return;
  }
  const yes = await askConfirm("为版本「" + row.version + "」创建风险暴露分类规则。会从已有分类复制一份，再在这一版上改。", {
    title: "创建风险暴露分类规则",
    confirmText: "创建"
  });
  if (!yes) return;
  error.value = "";
  creating.value = true;
  try {
    await createExposureVersion(row.version);
    openConfig(row, "/tree");
  } catch (err) {
    error.value = err.message || "没有创建";
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

  <div v-if="isNew" class="panel">
    <div class="panel-head">
      <h3>新建监管规则版本</h3>
      <span class="sub">保存后进入这一版的维护工作台</span>
    </div>
    <div class="panel-body">
      <p v-if="formError" class="notice danger">{{ formError }}</p>
      <div class="grid c2">
        <label class="field">编号
          <input v-model="form.id" type="text" placeholder="如：rv-mo-2026-2" />
        </label>
        <label class="field">地区
          <select v-model="form.jurisdiction" @change="alignInstitution">
            <option v-for="item in session.jurisdictions" :key="item.code" :value="item.code">{{ item.label }}</option>
          </select>
        </label>
        <label class="field">版本编号
          <input v-model="form.version" type="text" placeholder="如：MO-2026.2" />
        </label>
        <label class="field">规则名称
          <input v-model="form.name" type="text" />
        </label>
        <label class="field">规则类型
          <input v-model="form.ruleType" type="text" />
        </label>
        <label class="field">状态
          <select v-model="form.status">
            <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="field">生效日期
          <input v-model="form.effectiveFrom" type="date" />
        </label>
        <label class="field">失效日期
          <input v-model="form.effectiveTo" type="date" />
        </label>
        <label class="field">适用机构
          <select v-model="form.institution">
            <option
              v-for="item in session.orgs.filter((org) => org.jurisdiction === form.jurisdiction)"
              :key="item.id"
              :value="item.name"
            >{{ item.name }}</option>
          </select>
        </label>
        <label class="field">规则文件
          <input v-model="form.rulesetFile" type="text" />
        </label>
        <label class="field">发布时间
          <input v-model="form.publishedAt" type="text" />
        </label>
        <label class="field">维护人
          <input v-model="form.author" type="text" />
        </label>
        <label class="field" style="grid-column: 1 / -1">变更说明
          <textarea v-model="form.changelog"></textarea>
        </label>
      </div>
      <div style="margin-top: 12px; display: flex; gap: 8px">
        <button type="button" class="btn primary" :disabled="saving" @click="saveNew">{{ saving ? "正在创建" : "创建并进入工作台" }}</button>
        <button type="button" class="btn" @click="router.push('/versions')">取消</button>
      </div>
    </div>
  </div>

  <template v-else>
    <p class="notice info">
      监管规则维护工作台按版本配置。资本充足率和流动性各自列出相关子模块，点进去就是这一版的具体配置。
    </p>

    <AsyncView :load="load">
      <template #default="{ data }">
        <VersionContext :version="data" :nav="false" workbench />

        <div class="grid c2">
        <div class="panel">
          <div class="panel-head">
            <h3>资本充足率</h3>
            <span class="sub">配置参数</span>
          </div>
          <div class="panel-body">
            <div style="display: grid; gap: 8px">
              <button
                v-for="(link, index) in CAPITAL_LINKS"
                :key="link.path"
                type="button"
                class="arch-item"
                @click="link.path === '/tree' ? openExposure(data) : openConfig(data, link.path)"
              >
                <span class="idx">{{ index + 1 }}</span>
                <span>
                  <strong>{{ link.label }}</strong>
                  <span>{{ link.desc }}</span>
                </span>
                <span class="go">配置 →</span>
              </button>
            </div>
            <p v-if="!data.exposureCount" class="notice warn" style="margin: 12px 0 0">
              这一版还没有风险暴露分类规则，点上面的「暴露分类规则」会先复制一份再进入。
            </p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3>流动性</h3>
            <span class="sub">配置与计算</span>
          </div>
          <div class="panel-body">
            <div style="display: grid; gap: 8px">
              <button
                v-for="(link, index) in LIQUIDITY_LINKS"
                :key="link.path"
                type="button"
                class="arch-item"
                @click="openConfig(data, link.path)"
              >
                <span class="idx">{{ index + 1 }}</span>
                <span>
                  <strong>{{ link.label }}</strong>
                  <span>{{ link.desc }}</span>
                </span>
                <span class="go">进入 →</span>
              </button>
            </div>
            <p class="notice" style="margin: 12px 0 0">
              流动性暂未单独建配置页，明细、清单和判定标准在 HQLA 任务里维护。
            </p>
          </div>
        </div>
        </div>
      </template>
    </AsyncView>
  </template>
</template>
