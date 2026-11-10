<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createExposureVersion } from "@/api/exposure";
import { createRuleVersion, fetchRuleVersions, saveRuleVersion } from "@/api/rule";
import { useContext } from "@/composables/useContext";
import AsyncView from "@/components/AsyncView.vue";
import VersionContext from "@/components/VersionContext.vue";
import VersionInfoForm from "@/components/VersionInfoForm.vue";
import VersionModules from "@/components/VersionModules.vue";
import { askConfirm } from "@/utils/confirm";

const route = useRoute();
const router = useRouter();
const { session } = useContext();
const view = ref(null);
const error = ref("");
const creating = ref(false);
const editing = ref(false);
const isNew = computed(() => route.name === "version-new-workbench" || route.params.id === "new");
const form = ref(blankForm());
const formError = ref("");
const saving = ref(false);

function blankForm() {
  const code = session.jurisdiction || (session.jurisdictions[0] ? session.jurisdictions[0].code : "");
  return {
    id: "",
    jurisdiction: code,
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
  const rows = await fetchRuleVersions();
  const row = rows.find((item) => item.id === route.params.id);
  if (!row) throw new Error("没有找到这个监管规则版本");
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

function openModule(row, path) {
  if (!row) return;
  if (path === "/tree") {
    openExposure(row);
    return;
  }
  openConfig(row, path);
}
</script>

<template>
  <p v-if="error" class="notice danger">{{ error }}</p>

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
    <p class="notice info">
      监管规则维护工作台按版本配置。资本充足率和流动性各自列出相关子模块，点进去就是这一版的具体配置。
    </p>

    <AsyncView ref="view" :load="load">
      <template #default="{ data }">
        <VersionContext
          :version="data"
          :nav="false"
          workbench
          editable
          @edit="startEdit(data)"
        />
        <VersionInfoForm
          v-if="editing"
          :form="form"
          :error="formError"
          :saving="saving"
          @save="saveForm"
          @cancel="cancelForm"
        />
        <VersionModules :exposure-count="data.exposureCount" @open="openModule(data, $event)" />
      </template>
    </AsyncView>
  </template>
</template>
