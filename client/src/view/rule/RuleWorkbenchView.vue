<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createRuleVersion, fetchRuleVersionOverview, publishRuleVersion,
  saveRuleVersion, validateRuleVersion, withdrawRuleVersion
} from "@/api/rule";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import VersionContext from "@/components/VersionContext.vue";
import VersionInfoForm from "@/components/VersionInfoForm.vue";
import VersionModules from "@/components/VersionModules.vue";
import { askConfirm } from "@/utils/confirm";
import { configStatusLabel } from "@/utils/versionText";

const route = useRoute();
const router = useRouter();
const { session } = useContext();
const view = ref(null);
const error = ref("");
const message = ref("");
const busy = ref(false);
const creating = ref(false);
const editing = ref(false);
const isNew = computed(() => route.name === "version-new-workbench" || route.params.id === "new");
const form = ref(blankForm());
const formError = ref("");
const saving = ref(false);
const validation = ref(null);
const validationAt = ref("");

function blankForm() {
  return {
    id: "",
    jurisdiction: session.jurisdiction || "HK",
    version: "",
    name: "",
    ruleType: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "draft",
    institution: "",
    rulesetFile: "",
    publishedAt: "",
    author: "",
    changelog: ""
  };
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function autoVersion(code) {
  const d = new Date();
  return code + "-" + d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate();
}

function payload(row) {
  const code = row.jurisdiction || "";
  return {
    id: row.id || "rv-" + code.toLowerCase() + "-" + stamp(),
    jurisdiction: code,
    version: row.version || autoVersion(code),
    name: row.name,
    ruleType: row.ruleType || "",
    effectiveFrom: row.effectiveFrom || null,
    effectiveTo: row.effectiveTo || null,
    status: row.status,
    institution: row.institution || "",
    rulesetFile: row.rulesetFile || "",
    publishedAt: row.publishedAt || "",
    author: row.author || "",
    changelog: row.changelog || ""
  };
}

function startEdit(row) {
  error.value = "";
  formError.value = "";
  form.value = {
    ...row,
    effectiveFrom: row.effectiveFrom || "",
    effectiveTo: row.effectiveTo || "",
    creating: false
  };
  editing.value = true;
}

function cancelForm() {
  formError.value = "";
  if (isNew.value) {
    router.push("/versions");
    return;
  }
  editing.value = false;
}

async function saveForm(status) {
  if (saving.value || !form.value) return;
  formError.value = "";
  if (!form.value.jurisdiction) {
    formError.value = "地区不能为空";
    return;
  }
  if (!String(form.value.name || "").trim()) {
    formError.value = "规则名称不能为空";
    return;
  }
  if (isNew.value) form.value.status = status || "draft";
  saving.value = true;
  try {
    if (isNew.value) {
      const saved = await createRuleVersion(payload(form.value));
      session.jurisdiction = saved.jurisdiction;
      session.versionId = saved.id;
      router.replace({ name: "version-workbench", params: { id: saved.id } });
    } else {
      const saved = await saveRuleVersion(form.value.id, payload(form.value));
      session.jurisdiction = saved.jurisdiction;
      session.versionId = saved.id;
      editing.value = false;
      if (view.value) await view.value.reload();
    }
  } catch (err) {
    formError.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function load() {
  if (isNew.value) return null;
  const overview = await fetchRuleVersionOverview(route.params.id);
  validation.value = overview.validation;
  return overview;
}

function scopeTo(row) {
  session.jurisdiction = row.jurisdiction;
  session.versionId = row.id;
}

function openConfig(row, path) {
  scopeTo(row);
  if (path === "/exposure-config") {
    router.push({ path: path, query: { jurisdiction: row.jurisdiction, version: row.version } });
    return;
  }
  router.push(path);
}

function openModule(row, path) {
  if (!row) return;
  openConfig(row, path);
}

async function reload() {
  if (view.value) await view.value.reload();
}

async function runValidate() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    validation.value = await validateRuleVersion(route.params.id);
    validationAt.value = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    message.value = validation.value.ok ? "校验通过" : "校验发现 " + validation.value.errors.length + " 个阻断问题";
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runWithdraw() {
  const yes = await askConfirm("撤回发布后当前版本恢复可编辑，新任务暂停创建；已有任务仍按原发布快照复现。", {
    title: "撤回发布", confirmText: "撤回发布", danger: true
  });
  if (!yes) return;
  busy.value = true;
  error.value = "";
  try {
    await withdrawRuleVersion(route.params.id);
    message.value = "已撤回发布，当前版本恢复可编辑";
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runPublish() {
  const yes = await askConfirm("发布后当前版本只读，并生成正式配置快照。", {
    title: "发布版本", confirmText: "发布"
  });
  if (!yes) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await publishRuleVersion(route.params.id);
    message.value = "已发布，正式配置快照已生成";
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}





</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>
  <p v-if="message" class="notice info">{{ message }}</p>

  <template v-if="isNew">
    <p class="notice info">
      先录入版本核心信息。保存后进入监管规则维护工作台，再配置资本充足率和流动性的各项参数。
    </p>
    <VersionInfoForm
      :form="form"
      :error="formError"
      :saving="saving"
      creating
      @save="saveForm"
      @cancel="cancelForm"
    />
    <VersionModules disabled />
  </template>

  <template v-else>
    <AsyncView ref="view" :load="load">
      <template #default="{ data }">
        <template v-if="data">
          <VersionContext
            :version="data.version"
            :completeness="data.validation.completeness"
            :nav="false"
            workbench
            editable
            @edit="startEdit(data.version)"
          />

          <VersionInfoForm
            v-if="editing"
            :form="form"
            :error="formError"
            :saving="saving"
            @save="saveForm"
            @cancel="cancelForm"
          />

          <div class="panel">
            <div class="panel-head">
              <h3>版本治理</h3>
              <span class="sub" title="配置修订来自 config_revision，与下方「版本修订号」不是同一个数字">完整度 {{ data.validation.completeness }}% · 配置修订 {{ data.revision }}</span>
              <span class="spacer"></span>
              <button type="button" class="btn sm" :disabled="busy" title="按当前配置实时校验，不写入版本记录" @click="runValidate">重新校验</button>
              <button v-if="data.version.status === 'draft'" type="button" class="btn sm" :disabled="busy" title="发布后版本只读并生成正式配置快照" @click="runPublish">发布</button>
              <button v-if="data.version.status === 'published'" type="button" class="btn sm" :disabled="busy" @click="runWithdraw">撤回发布</button>
            </div>
            <div class="panel-body">
              <div class="grid c4">
                <div class="field"><label>配置状态</label><div>{{ configStatusLabel(data.version.configStatus) }}</div></div>
                <div class="field"><label>版本修订号</label><div>{{ data.version.revision }}</div></div>
                <div class="field"><label>发布快照</label><div class="mono">{{ data.version.publishedSnapshotId || "—" }}</div></div>
              </div>
              <div v-if="validation" class="governance-result" style="margin-top: 12px">
                <span class="tag" :class="validation.ok ? 'green' : 'red'">{{ validation.ok ? "校验通过" : "存在阻断问题" }}</span>
                <span class="dim" style="font-size: 11.5px">实时校验{{ validationAt ? " · 本次 " + validationAt : "" }}</span>
                <span v-if="validation.warnings && validation.warnings.length" class="tag amber">{{ validation.warnings.length }} 条提示</span>
                <ul v-if="validation.errors && validation.errors.length" class="governance-list">
                  <li v-for="text in validation.errors.slice(0, 8)" :key="text">{{ text }}</li>
                </ul>
                <ul v-else-if="validation.warnings && validation.warnings.length" class="governance-list">
                  <li v-for="text in validation.warnings.slice(0, 5)" :key="text">{{ text }}</li>
                </ul>
              </div>
            </div>
          </div>

          <VersionModules
            :modules="data.modules"
            :published="data.version.status === 'published'"
            @open="openModule(data.version, $event)"
          />

        </template>
      </template>
    </AsyncView>
  </template>
</template>

<style scoped>
.governance-result { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.governance-list { width: 100%; margin: 4px 0 0; padding-left: 18px; color: #b91c1c; font-size: 12px; }
.governance-list li { margin: 2px 0; }
</style>
