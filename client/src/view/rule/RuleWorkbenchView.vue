<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  cloneRuleVersion, compareRuleSnapshots, createRuleSnapshot, createRuleVersion, fetchRuleVersionDiff,
  fetchRuleVersionOverview, fetchRuleVersionRevisions, publishRuleVersion, rollbackRuleSnapshot,
  saveRuleVersion, submitRuleVersionReview, validateRuleVersion
} from "@/api/rule";
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
const message = ref("");
const busy = ref(false);
const creating = ref(false);
const editing = ref(false);
const isNew = computed(() => route.name === "version-new-workbench" || route.params.id === "new");
const form = ref(blankForm());
const formError = ref("");
const saving = ref(false);
const validation = ref(null);
const revisions = ref([]);
const diff = ref(null);
const snapshotDiff = ref(null);
const cloneOpen = ref(false);
const cloneForm = ref({ id: "", version: "", name: "" });

function blankForm() {
  return {
    id: "",
    jurisdiction: "HK",
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
    changelog: "",
    framework: "CAR"
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
    changelog: row.changelog || "",
    framework: row.framework || "CAR"
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
  revisions.value = await fetchRuleVersionRevisions(route.params.id).catch(() => []);
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
    message.value = validation.value.ok ? "校验通过" : "校验发现 " + validation.value.errors.length + " 个阻断问题";
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runSubmit() {
  const yes = await askConfirm("提交审核后版本进入审核中，配置仍可修改但不能发布未通过校验的版本。", {
    title: "提交审核", confirmText: "提交"
  });
  if (!yes) return;
  busy.value = true;
  error.value = "";
  try {
    await submitRuleVersionReview(route.params.id);
    message.value = "已提交审核";
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runPublish() {
  const yes = await askConfirm("发布后当前版本只读，并生成正式配置快照。后续修改需要新建版本。", {
    title: "发布版本", confirmText: "发布"
  });
  if (!yes) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await publishRuleVersion(route.params.id);
    message.value = "已发布，快照 " + (result.snapshot ? result.snapshot.id : "");
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runSnapshot() {
  busy.value = true;
  error.value = "";
  try {
    const snapshot = await createRuleSnapshot(route.params.id);
    message.value = "已生成快照 " + snapshot.id;
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

function openClone(row) {
  cloneForm.value = {
    id: "rv-" + String(row.jurisdiction || "hk").toLowerCase() + "-" + stamp(),
    version: autoVersion(row.jurisdiction || "HK"),
    name: row.name
  };
  cloneOpen.value = true;
  error.value = "";
}

async function runClone() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const created = await cloneRuleVersion(route.params.id, cloneForm.value);
    session.jurisdiction = created.version.jurisdiction;
    session.versionId = created.version.id;
    cloneOpen.value = false;
    router.replace({ name: "version-workbench", params: { id: created.version.id } });
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runCompare(snapshot, index, list) {
  if (!snapshot || index >= list.length - 1) return;
  busy.value = true;
  error.value = "";
  try {
    snapshotDiff.value = await compareRuleSnapshots(snapshot.id, list[index + 1].id);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runRollback(snapshot) {
  const yes = await askConfirm("把当前版本配置恢复到这个快照。已发布版本不能回滚，恢复前会自动保留当前修订记录。", {
    title: "恢复快照", confirmText: "恢复", danger: true
  });
  if (!yes) return;
  busy.value = true;
  error.value = "";
  try {
    await rollbackRuleSnapshot(snapshot.id);
    message.value = "已恢复到快照 " + snapshot.id;
    await reload();
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

async function runDiff(row) {
  if (!row.sourceVersionId) return;
  busy.value = true;
  error.value = "";
  try {
    diff.value = await fetchRuleVersionDiff(route.params.id, row.sourceVersionId);
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

          <div class="panel">
            <div class="panel-head">
              <h3>版本治理</h3>
              <span class="sub">完整度 {{ data.validation.completeness }}% · 修订 {{ data.revision }}</span>
              <span class="spacer"></span>
              <button type="button" class="btn sm" :disabled="busy" @click="runValidate">校验</button>
              <button v-if="data.version.status === 'draft'" type="button" class="btn sm" :disabled="busy" @click="runSubmit">提交审核</button>
              <button v-if="['draft', 'reviewing'].includes(data.version.status)" type="button" class="btn sm primary" :disabled="busy" @click="runPublish">发布</button>
              <button type="button" class="btn sm" :disabled="busy" @click="runSnapshot">生成快照</button>
              <button type="button" class="btn sm" :disabled="busy" @click="openClone(data.version)">复制为新版本</button>
              <button v-if="data.version.sourceVersionId" type="button" class="btn sm" :disabled="busy" @click="runDiff(data.version)">与来源版本比较</button>
            </div>
            <div class="panel-body">
              <div class="grid c4">
                <div class="field"><label>监管框架</label><div>{{ data.version.framework || "CAR" }}</div></div>
                <div class="field"><label>配置状态</label><div>{{ data.version.configStatus || "—" }}</div></div>
                <div class="field"><label>版本修订号</label><div>{{ data.version.revision }}</div></div>
                <div class="field"><label>发布快照</label><div class="mono">{{ data.version.publishedSnapshotId || "—" }}</div></div>
              </div>
              <div v-if="validation" class="governance-result" style="margin-top: 12px">
                <span class="tag" :class="validation.ok ? 'green' : 'red'">{{ validation.ok ? "校验通过" : "存在阻断问题" }}</span>
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

          <div v-if="cloneOpen" class="panel">
            <div class="panel-head">
              <h3>复制为新版本</h3>
              <span class="sub">复制规则文档、参数表、名单、EAD 和缓释配置</span>
              <span class="spacer"></span>
              <button type="button" class="btn sm" @click="cloneOpen = false">取消</button>
            </div>
            <div class="panel-body">
              <div class="grid c3">
                <label class="field">新版本编号<input v-model="cloneForm.id" type="text" /></label>
                <label class="field">新版本号<input v-model="cloneForm.version" type="text" /></label>
                <label class="field">新版本名称<input v-model="cloneForm.name" type="text" /></label>
              </div>
              <div style="margin-top: 12px">
                <button type="button" class="btn primary" :disabled="busy" @click="runClone">复制并进入</button>
              </div>
            </div>
          </div>

          <div v-if="diff" class="panel">
            <div class="panel-head">
              <h3>与来源版本 {{ diff.sourceVersion }} 的差异</h3>
              <span class="spacer"></span>
              <button type="button" class="btn sm" @click="diff = null">关闭</button>
            </div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>对象</th><th class="num">新增</th><th class="num">删除</th><th class="num">修改</th><th>变更项</th></tr></thead>
                <tbody>
                  <tr v-for="group in diff.groups" :key="group.type">
                    <td class="mono">{{ group.type }}</td>
                    <td class="num">{{ group.added }}</td>
                    <td class="num">{{ group.removed }}</td>
                    <td class="num">{{ group.changed }}</td>
                    <td class="small">{{ group.changes.slice(0, 8).map((item) => item.key + " " + item.change).join("；") || "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>配置快照</h3>
              <span class="sub">{{ data.snapshots.length }} 份</span>
            </div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>快照</th><th>序号</th><th>状态</th><th>哈希</th><th>生成人</th><th>生成时间</th><th>操作</th></tr></thead>
                <tbody>
                  <tr v-for="(snapshot, index) in data.snapshots" :key="snapshot.id">
                    <td class="mono small">{{ snapshot.id }}</td>
                    <td class="num">{{ snapshot.snapshot_no }}</td>
                    <td><span class="tag" :class="snapshot.status === 'PUBLISHED' ? 'green' : 'muted'">{{ snapshot.status }}</span></td>
                    <td class="mono small">{{ String(snapshot.config_hash || "").slice(0, 12) }}</td>
                    <td>{{ snapshot.created_by || "—" }}</td>
                    <td class="mono small">{{ snapshot.created_at }}</td>
                    <td class="num">
                      <button type="button" class="btn sm" :disabled="busy || index >= data.snapshots.length - 1" @click="runCompare(snapshot, index, data.snapshots)">对比上一版</button>
                      <button type="button" class="btn sm" :disabled="busy || data.version.status === 'published'" @click="runRollback(snapshot)">恢复</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!data.snapshots.length" class="empty">还没有配置快照。发布或手动生成后会在这里出现。</div>
              <div v-if="snapshotDiff" class="small" style="margin-top: 10px">
                快照 {{ snapshotDiff.left.id }} 与 {{ snapshotDiff.right.id }}：
                {{ snapshotDiff.sameHash ? "完全一致" : snapshotDiff.changes.length + " 处差异" }}
                <span v-if="snapshotDiff.changes.length">（{{ snapshotDiff.changes.slice(0, 8).map((item) => item.key + " " + item.change).join("；") }}）</span>
              </div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-head">
              <h3>配置修订记录</h3>
              <span class="sub">最近 {{ revisions.length }} 条</span>
            </div>
            <div class="panel-body tight">
              <table class="tbl compact">
                <thead><tr><th>时间</th><th>对象</th><th>对象键</th><th>动作</th><th>修订号</th><th>操作人</th></tr></thead>
                <tbody>
                  <tr v-for="row in revisions" :key="row.id">
                    <td class="mono small">{{ row.created_at }}</td>
                    <td>{{ row.object_type }}</td>
                    <td class="mono small">{{ row.object_key }}</td>
                    <td><span class="tag muted">{{ row.action }}</span></td>
                    <td class="num">{{ row.revision }}</td>
                    <td>{{ row.actor || "—" }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!revisions.length" class="empty">还没有配置修订记录。</div>
            </div>
          </div>

          <VersionInfoForm
            v-if="editing"
            :form="form"
            :error="formError"
            :saving="saving"
            @save="saveForm"
            @cancel="cancelForm"
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
