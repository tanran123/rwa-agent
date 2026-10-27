import { inject, onUnmounted, provide } from "vue";

const KEY = Symbol("agentForms");

export function provideAgentForms() {
  const slot = { current: null };
  provide(KEY, slot);
  return slot;
}

export function useAgentForm(source) {
  const slot = inject(KEY, null);
  if (!slot) return;
  const read = typeof source === "function" ? source : () => source;
  slot.current = read;
  onUnmounted(() => {
    if (slot.current === read) slot.current = null;
  });
}

export function useAgentFormSlot() {
  return inject(KEY, null);
}

export function readAgentForms(slot) {
  if (!slot || typeof slot.current !== "function") return [];
  const spec = slot.current();
  const forms = spec && spec.forms;
  return Array.isArray(forms) ? forms : [];
}

function coerce(current, value) {
  if (typeof current === "boolean") return value === true || value === "true" || value === 1 || value === "1";
  if (typeof current === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : current;
  }
  if (current && typeof current === "object" && !Array.isArray(current)) {
    const child = { ...current };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.keys(child).forEach((name) => {
        if (Object.prototype.hasOwnProperty.call(value, name)) child[name] = coerce(child[name], value[name]);
      });
    }
    return child;
  }
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return value == null ? current : String(value);
}

export function finishSave(run, errorRef) {
  return async () => {
    const result = await run();
    const message = errorRef && errorRef.value;
    if (result === false || message) throw new Error(message || "没有保存");
  };
}

export function fillForm(base, values) {
  const next = { ...base };
  const incoming = values && typeof values === "object" ? values : {};
  Object.keys(base).forEach((key) => {
    if (key === "creating") return;
    if (base[key] == null) return;
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) return;
    next[key] = coerce(base[key], incoming[key]);
  });
  return next;
}
