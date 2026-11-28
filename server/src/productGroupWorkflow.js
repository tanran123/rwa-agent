/** Product-group Agent workflow: build context, proxy Flask SSE, persist run/proposal. */
import http from "node:http";
import { query } from "./db.js";
import { buildProductAssistContext } from "./productAssist.js";

// 上游是模型工作流，单步可能要几分钟；只按空闲时间兜底，不按总时长截断。
const UPSTREAM_IDLE_MS = 10 * 60 * 1000;

function stamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function uid(prefix) {
  return prefix + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function jsonText(value) {
  try { return JSON.stringify(value == null ? null : value); } catch { return "null"; }
}

function groupContextFor(context, body, action) {
  const plan = context.groupPlan || [];
  const group = plan.find((item) => item.id === String(body.groupId || ""));
  if (!group) throw Object.assign(new Error("没有这个监管字段分组"), { status: 404 });
  // 工作流内部自己决定是否需要系统计算字段：Answer/Review 需要全部字段，
  // Propose/Refine 在节点里再排除 systemCalc。
  const targetFields = group.fields || [];
  return {
    action,
    mode: "group_flow",
    product: context.product,
    exposureClasses: context.exposureClasses,
    group: {
      id: group.id,
      label: group.label,
      description: group.description,
      standardGroup: group.standardGroup,
      suggestedStandardGroup: group.suggestedStandardGroup,
      targetFields
    },
    targetFields,
    existingStandardFields: context.existingStandardFields,
    existingMappings: context.existingMappings,
    dictionaries: context.dictionaries,
    messages: Array.isArray(body.messages) ? body.messages.slice(-20) : [],
    currentProposal: body.currentProposal || null,
    previousProposal: body.previousProposal || null,
    currentSelections: Array.isArray(body.currentSelections) ? body.currentSelections : [],
    selection: body.selection || null,
    constraints: Array.isArray(body.constraints) ? body.constraints : [],
    edits: Array.isArray(body.edits) ? body.edits : [],
    standardFieldGroups: context.standardFieldGroups,
    knownTargetFields: context.knownTargetFields,
    text: String(body.text || "").trim(),
    threadId: String(body.threadId || ""),
    runId: String(body.runId || ""),
    proposalId: String(body.proposalId || ""),
    draftDigest: String(body.draftDigest || ""),
    baseDraftDigest: String(body.baseDraftDigest || ""),
    approvalStatus: String(body.approvalStatus || ""),
    draftStandardFields: Array.isArray(body.draftStandardFields) ? body.draftStandardFields : [],
    draftMappings: Array.isArray(body.draftMappings) ? body.draftMappings : []
  };
}

async function persistRun(row) {
  try {
    await query(
      `INSERT INTO product_group_run
        (id, thread_id, run_id, rule_version_id, rule_version, product_family, group_id, action,
         intent, status, proposal_id, draft_digest, error, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), intent = VALUES(intent), proposal_id = VALUES(proposal_id),
         error = VALUES(error), updated_at = VALUES(updated_at)`,
      [
        row.id, row.threadId, row.runId, row.ruleVersionId || "", row.version || "",
        row.family || "", row.groupId || "", row.action || "auto", row.intent || "",
        row.status || "running", row.proposalId || "", row.draftDigest || "", row.error || "",
        row.actor || "", row.createdAt || stamp(), row.updatedAt || stamp()
      ]
    );
  } catch (err) {
    console.error("[product-group-run]", err.message);
  }
}

async function persistProposal(row, result) {
  try {
    await query(
      `INSERT INTO product_group_proposal
        (id, proposal_id, run_id, thread_id, rule_version_id, rule_version, product_family, group_id,
         version_no, proposal_json, diff_json, review_json, conflicts_json, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE proposal_json = VALUES(proposal_json), diff_json = VALUES(diff_json),
         review_json = VALUES(review_json), conflicts_json = VALUES(conflicts_json), status = VALUES(status)`,
      [
        row.id, row.proposalId, row.runId, row.threadId, row.ruleVersionId || "", row.version || "",
        row.family || "", row.groupId || "", jsonText(result.proposal || null), jsonText(result.diff || null),
        jsonText(result.reviewFindings || []), jsonText(result.conflicts || []),
        result.requiresApproval ? "approval_required" : "ready", row.actor || "", stamp()
      ]
    );
    const decisions = ((result.proposal && result.proposal.decisions) || []).filter((item) => item && item.targetField);
    for (const decision of decisions) {
      try {
        await query(
          `INSERT INTO product_group_decision_audit
            (proposal_id, group_id, target_field, decision_type, action, before_json, after_json, actor, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.proposalId, row.groupId || "", String(decision.targetField), String(decision.decisionType || ""),
            result.requiresApproval ? "recommend" : "submit", jsonText(null), jsonText(decision), row.actor || "", stamp()]
        );
      } catch (err) {
        console.error("[product-group-decision-audit]", err.message);
      }
    }
  } catch (err) {
    console.error("[product-group-proposal]", err.message);
  }
}

function parseFrame(frame) {
  let event = "message";
  const data = [];
  frame.split("\n").forEach((line) => {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  });
  if (!data.length) return null;
  let payload = null;
  try { payload = JSON.parse(data.join("\n")); } catch { payload = { text: data.join("\n") }; }
  return { event, payload };
}

function abortError(message) {
  return Object.assign(new Error(message || "已中断"), { name: "AbortError" });
}

/** POST 到 Flask 并拿到未缓冲的响应流；客户端断开时同步销毁上游连接。 */
function openUpstream(url, body, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
    }, (res) => resolve(res));
    req.on("error", reject);
    req.setTimeout(UPSTREAM_IDLE_MS, () => {
      req.destroy(Object.assign(new Error("模型长时间没有返回内容"), { name: "TimeoutError" }));
    });
    if (signal) signal.addEventListener("abort", () => req.destroy(abortError()), { once: true });
    req.end(body);
  });
}

function readText(stream) {
  return new Promise((resolve) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", () => resolve(text));
  });
}

function drain(stream) {
  return new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
    stream.on("aborted", () => reject(abortError("上游连接中断")));
  });
}

export async function streamGroupWorkflow(ctx, body, llm, options = {}) {
  const resume = options.resume === true;
  const approvalStatus = resume ? String(body.approvalStatus || "approved") : "";
  const context = await buildProductAssistContext({
    version: String(body.version || ""),
    family: String(body.family || ""),
    entryIndex: body.entryIndex,
    mode: "group_flow",
    messages: body.messages,
    currentProposal: body.currentProposal,
    draftStandardFields: body.draftStandardFields,
    draftMappings: body.draftMappings,
    draftDirty: body.draftDirty,
    scopeClasses: body.exposureClasses
  });
  const payload = groupContextFor(context, body, "auto");
  payload.approvalStatus = approvalStatus;
  payload.runId = payload.runId || uid("RUN");
  payload.threadId = payload.threadId || [body.version || "", body.family || "", body.groupId || ""].join(":");
  payload.proposalId = payload.proposalId || uid("PROP");
  const actor = String(ctx.get("x-rwa-user") || "");
  const row = {
    id: payload.runId,
    threadId: payload.threadId,
    runId: payload.runId,
    proposalId: payload.proposalId,
    ruleVersionId: "",
    version: String(body.version || ""),
    family: String(body.family || ""),
    groupId: String(body.groupId || ""),
    action: "auto",
    draftDigest: payload.draftDigest,
    actor,
    status: "running",
    createdAt: stamp(),
    updatedAt: stamp()
  };
  await persistRun(row);

  const controller = new AbortController();
  ctx.res.setTimeout(0);
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  ctx.res.flushHeaders();
  ctx.respond = false;
  ctx.res.on("close", () => controller.abort());
  const write = (name, data) => {
    if (ctx.res.writableEnded) return;
    ctx.res.write("event: " + name + "\n");
    ctx.res.write("data: " + JSON.stringify(data || {}) + "\n\n");
  };
  write("status", { stage: "workflow", message: "正在启动分组智能配置工作流…", total: payload.targetFields.length });
  let finalResult = null;
  try {
    const url = "http://127.0.0.1:8766/api/product/assist/group/workflow" + (resume ? "/resume" : "");
    const upstream = await openUpstream(
      url,
      JSON.stringify({ ...payload, ...(llm ? { llm } : {}) }),
      controller.signal
    );
    if (upstream.statusCode !== 200) {
      const text = await readText(upstream);
      write("error", { error: text || "分组智能配置失败" });
      row.status = "failed";
      row.error = text || "分组智能配置失败";
      await persistRun({ ...row, updatedAt: stamp() });
      ctx.res.end();
      return;
    }
    let buffer = "";
    let upstreamError = "";
    upstream.setEncoding("utf8");
    upstream.on("data", (chunk) => {
      if (ctx.res.writableEnded) return;
      ctx.res.write(chunk);
      buffer += chunk;
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const parsed = parseFrame(frame);
        if (parsed && parsed.event === "result") finalResult = parsed.payload;
        if (parsed && parsed.event === "error") upstreamError = parsed.payload.error || "分组智能配置失败";
        if (parsed && parsed.event === "intent") row.intent = parsed.payload.intent && parsed.payload.intent.type || "";
        index = buffer.indexOf("\n\n");
      }
    });
    await drain(upstream);
    if (buffer.trim()) {
      const parsed = parseFrame(buffer);
      if (parsed && parsed.event === "result") finalResult = parsed.payload;
    }
    if (finalResult) {
      row.status = finalResult.status || "completed";
      row.proposalId = finalResult.proposalId || row.proposalId;
      row.intent = finalResult.intent || row.intent;
      await persistRun({ ...row, updatedAt: stamp() });
      await persistProposal({ ...row, id: row.proposalId, proposalId: row.proposalId }, finalResult);
    } else {
      row.status = "failed";
      row.error = upstreamError || "工作流没有返回结果";
      // 上游已经发过 error 时不要再补一条，否则会盖掉具体原因。
      if (!upstreamError) write("error", { error: row.error });
      await persistRun({ ...row, updatedAt: stamp() });
    }
    ctx.res.end();
  } catch (err) {
    if (err && err.name === "AbortError") {
      // 浏览器关掉面板或重新发起时，别把记录永远留在 running。
      row.status = "aborted";
      row.error = "客户端已断开";
      await persistRun({ ...row, updatedAt: stamp() });
      if (!ctx.res.writableEnded) ctx.res.end();
      return;
    }
    console.error(err);
    write("error", { error: err.message || "分组智能配置失败" });
    row.status = "failed";
    row.error = err.message || "分组智能配置失败";
    await persistRun({ ...row, updatedAt: stamp() });
    if (!ctx.res.writableEnded) ctx.res.end();
  }
}

export async function readGroupRun(runId) {
  const rows = await query("SELECT * FROM product_group_run WHERE run_id = ? OR id = ? LIMIT 1", [runId, runId]);
  return rows[0] || null;
}

export async function readGroupProposal(proposalId) {
  const rows = await query("SELECT * FROM product_group_proposal WHERE proposal_id = ? OR id = ? LIMIT 1", [proposalId, proposalId]);
  return rows[0] || null;
}

export async function readGroupConstraints(version, family, groupId) {
  return query(
    "SELECT * FROM product_group_constraint WHERE rule_version = ? AND product_family = ? AND group_id = ? AND status = 'ACTIVE' ORDER BY created_at",
    [version || "", family || "", groupId || ""]
  );
}

export async function saveGroupConstraints(version, family, groupId, constraints, actor = "") {
  await query(
    "UPDATE product_group_constraint SET status = 'ARCHIVED', updated_at = ? WHERE rule_version = ? AND product_family = ? AND group_id = ? AND status = 'ACTIVE'",
    [stamp(), version || "", family || "", groupId || ""]
  );
  for (const item of constraints || []) {
    await query(
      `INSERT INTO product_group_constraint
        (id, rule_version_id, rule_version, product_family, group_id, constraint_type, constraint_json, status, created_by, created_at, updated_at)
       VALUES (?, '', ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
      [uid("PGC"), version || "", family || "", groupId || "", String(item.type || ""), jsonText(item), actor, stamp(), stamp()]
    );
  }
  return readGroupConstraints(version, family, groupId);
}
