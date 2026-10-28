import request from "./request";

export const sendAgentChat = (page, messages, config, threadId, confirm, catalog) => {
  const body = { page, messages, config, threadId };
  if (confirm === true || confirm === false) body.confirm = confirm;
  if (catalog && typeof catalog === "object") body.catalog = catalog;
  return request.post("/agent/chat", body, { timeout: 90000 });
};
