import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cachePath = path.join(root, "agent/subagents/weight/paper/底稿模型计算.json");
let cached = null;
let samples = null;

function load() {
  if (!cached) cached = JSON.parse(readFileSync(cachePath, "utf8"));
  return cached;
}

export function paperView(offset = 0, limit = 80) {
  const data = load();
  const all = data.process_rows || [];
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(200, Math.max(1, Number(limit) || 80));
  return {
    file: data.file,
    asOf: data.as_of,
    unit: data.unit,
    fieldCount: data.field_count,
    mappedFields: data.mapped_fields,
    eadYi: data.ead_yi,
    rwaYi: data.rwa_yi,
    unpricedYi: data.unpriced_yi,
    rwaThousand: data.rwa_thousand,
    note: data.note,
    modelNote: data.model_note,
    sheetPlan: data.sheet_plan || [],
    lines: data.lines || [],
    coverage: data.coverage || [],
    rowCount: all.length,
    offset: start,
    rows: all.slice(start, start + size).map((row) => ({
      sheet: row.sheet || "",
      excelRow: row.excel_row,
      name: row.name || "",
      exposure: row.exposure || "",
      weight: typeof row.weight === "number" ? row.weight : null,
      weightText: typeof row.weight === "number" ? (row.weight_text || "") : "未定权重",
      ead: Number(row.ead) || 0,
      rwa: typeof row.rwa === "number" ? row.rwa : null,
      trace: row.trace || ""
    }))
  };
}

export function uploadSamples() {
  if (samples) return samples;
  const src = readFileSync(path.join(root, "server/data/data.js"), "utf8");
  const start = src.indexOf("const SAMPLE_UPLOAD");
  const end = src.indexOf("const VERSIONS");
  if (start < 0 || end < 0) throw new Error("找不到内置上传样例");
  const got = new Function(src.slice(start, end) + "\nreturn { SAMPLE_UPLOAD, CATALOG_DEMO };")();
  const sample = got.SAMPLE_UPLOAD;
  const catalog = got.CATALOG_DEMO;
  samples = {
    sample: {
      file: sample.file,
      sheet: sample.sheet,
      headerRow: sample.headerRow,
      columns: sample.columns,
      rows: sample.rows,
      aiSuggest: sample.aiSuggest
    },
    catalog: {
      file: catalog.file,
      sheet: catalog.sheet,
      headerRow: catalog.headerRow,
      columns: catalog.columns,
      rows: catalog.rows,
      map: catalog.map
    }
  };
  return samples;
}
