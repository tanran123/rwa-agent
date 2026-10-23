import { reactive } from "vue";

export const confirmState = reactive({
  open: false,
  title: "请确认",
  detail: "",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  danger: false
});

let pending = null;

export function askConfirm(message, options) {
  const extra = options || {};
  if (pending) pending(false);
  confirmState.title = extra.title || "请确认";
  confirmState.detail = extra.detail || "";
  confirmState.message = String(message || "");
  confirmState.confirmText = extra.confirmText || "确定";
  confirmState.cancelText = extra.cancelText || "取消";
  confirmState.danger = !!extra.danger;
  confirmState.open = true;
  return new Promise((resolve) => {
    pending = (value) => {
      pending = null;
      confirmState.open = false;
      resolve(!!value);
    };
  });
}

export function settleConfirm(value) {
  if (pending) pending(value);
  else confirmState.open = false;
}
