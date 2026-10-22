import request from "./request";

export const sendAgentChat = (page, messages, config) => request.post("/agent/chat", { page, messages, config }, { timeout: 90000 });
