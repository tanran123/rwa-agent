const CONFIG_STATUS_LABELS = {
  CONFIGURING: "配置中",
  PUBLISHED: "已发布",
  DRAFT: "草稿",
  APPROVED: "已批准",
  REJECTED: "已退回"
};

/** 版本配置状态统一显示中文；未知值保留原样，避免把后端新状态吞掉。 */
export function configStatusLabel(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "—";
  return CONFIG_STATUS_LABELS[text.toUpperCase()] || text;
}
