import { computed, reactive } from "vue";
import { askConfirm } from "@/utils/confirm";

export function usePick() {
  const picked = reactive({});

  function on(id) {
    return !!picked[String(id)];
  }

  function toggle(id) {
    const key = String(id);
    if (picked[key]) delete picked[key];
    else picked[key] = true;
  }

  function ids() {
    return Object.keys(picked);
  }

  function drop(id) {
    delete picked[String(id)];
  }

  function clear() {
    ids().forEach((key) => delete picked[key]);
  }

  function allOn(rows, key) {
    const list = rows || [];
    const name = key || "id";
    return list.length > 0 && list.every((row) => picked[String(row[name])]);
  }

  function toggleAll(rows, key) {
    const list = rows || [];
    const name = key || "id";
    if (allOn(list, name)) list.forEach((row) => delete picked[String(row[name])]);
    else list.forEach((row) => { picked[String(row[name])] = true; });
  }

  function visibleIds(rows, key) {
    const name = key || "id";
    const have = {};
    (rows || []).forEach((row) => { have[String(row[name])] = true; });
    return ids().filter((id) => have[id]);
  }

  const count = computed(() => Object.keys(picked).length);
  return reactive({ on, toggle, ids, drop, clear, allOn, toggleAll, visibleIds, count });
}

export function useBatchNote() {
  const state = reactive({ text: "", kind: "ok" });

  function show(result) {
    const deleted = result.deleted || [];
    const blocked = result.blocked || [];
    const parts = [];
    if (deleted.length) parts.push("已删除 " + deleted.length + " 条");
    if (blocked.length) parts.push(blocked.map((item) => item.id + "：" + item.error).join("；"));
    state.text = parts.join("。");
    state.kind = blocked.length ? "warn" : "ok";
  }

  function fail(message) {
    state.text = message || "删除失败";
    state.kind = "danger";
  }

  function clear() {
    state.text = "";
  }

  return { state, show, fail, clear };
}

export async function runBatch(pick, rows, key, remove, note, form, formId) {
  const selected = pick.visibleIds(rows, key);
  if (!selected.length) return null;
  const yes = await askConfirm("删除选中的 " + selected.length + " 条。被引用的会留下来。", {
    title: "批量删除",
    confirmText: "删除",
    danger: true
  });
  if (!yes) return null;
  note.clear();
  try {
    const result = await remove(selected);
    const gone = {};
    (result.deleted || []).forEach((id) => { gone[String(id)] = true; });
    selected.forEach((id) => { if (gone[id]) pick.drop(id); });
    if (form && form.value && formId) {
      const current = formId(form.value);
      if (current != null && current !== "" && gone[String(current)]) form.value = null;
    }
    note.show(result);
    return result;
  } catch (err) {
    note.fail(err.message);
    return null;
  }
}
