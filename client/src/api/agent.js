import request from "./request";

export const sendAgentChat = (page, messages) => request.post("/agent/chat", { page, messages }, { timeout: 90000 });
