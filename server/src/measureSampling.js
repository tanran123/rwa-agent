/**
 * Sampling for the product-type capability.
 *
 * Each product-code group sends a seeded random sample of loans with all
 * non-empty fields, not the first three rows with twelve cells. Seeds come
 * from the upload id, so re-running the same workbook picks the same rows.
 */

const SAMPLE_KEYS = [
  "Product Code",
  "productCode",
  "Facility Type",
  "facilityType",
  "GL A/C No.",
  "glAcct",
  "Customer Name",
  "name",
  "Account Type"
];

export const SAMPLE_ROWS = 8;
export const SAMPLE_MIN_ROWS = 5;
export const SAMPLE_VALUE_CHARS = 120;
export const SAMPLE_ROW_FIELDS = 100;
export const SAMPLE_GROUP_CHARS = 12000;
export const SAMPLE_TOTAL_CHARS = 80000;

export function cellText(value, limit = 60) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  return text.length > limit ? text.slice(0, limit) : text;
}

export function productCodeValue(row) {
  if (!row || typeof row !== "object") return "";
  const direct = row.productCode != null ? String(row.productCode).trim() : "";
  if (direct) return direct;
  const header = row["Product Code"] != null ? String(row["Product Code"]).trim() : "";
  return header;
}

export function sampleCells(row, maxFields = SAMPLE_ROW_FIELDS) {
  const keys = Object.keys(row || {});
  const ordered = [
    ...SAMPLE_KEYS.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !SAMPLE_KEYS.includes(key))
  ];
  const next = {};
  for (const key of ordered) {
    if (Object.keys(next).length >= maxFields) break;
    const text = cellText(row[key], SAMPLE_VALUE_CHARS);
    if (text) next[key] = text;
  }
  return next;
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trimFields(sample, maxFields) {
  const out = {};
  for (const key of Object.keys(sample)) {
    if (Object.keys(out).length >= maxFields) break;
    out[key] = sample[key];
  }
  return out;
}

function shrinkGroup(samples, limit) {
  let out = samples;
  if (JSON.stringify(out).length <= limit) return out;
  const floor = Math.min(SAMPLE_MIN_ROWS, out.length);
  while (out.length > floor && JSON.stringify(out).length > limit) {
    out = out.slice(0, out.length - 1);
  }
  let maxFields = 60;
  while (maxFields >= 10 && JSON.stringify(out).length > limit) {
    out = out.map((sample) => trimFields(sample, maxFields));
    maxFields -= 10;
  }
  return out;
}

function shrinkTotal(groups) {
  const size = () => groups.reduce((sum, group) => sum + JSON.stringify(group.samples).length, 0);
  if (size() <= SAMPLE_TOTAL_CHARS) return groups;
  for (const group of groups) group.samples = group.samples.slice(0, Math.min(SAMPLE_MIN_ROWS, group.samples.length));
  if (size() <= SAMPLE_TOTAL_CHARS) return groups;
  for (const group of groups) group.samples = group.samples.map((sample) => trimFields(sample, 30));
  if (size() <= SAMPLE_TOTAL_CHARS) return groups;
  for (const group of groups) group.samples = group.samples.map((sample) => trimFields(sample, 20));
  return groups;
}

export function productGroups(rows, options = {}) {
  const wanted = Math.max(SAMPLE_MIN_ROWS, Math.min(10, Number(options.rows) || SAMPLE_ROWS));
  const seed = String(options.seed || "");
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = productCodeValue(row);
    let group = groups.get(id);
    if (!group) {
      group = { id, count: 0, picked: [], random: mulberry32(hashSeed(id + "|" + seed)) };
      groups.set(id, group);
    }
    group.count += 1;
    if (group.picked.length < wanted) {
      group.picked.push(row);
      return;
    }
    const slot = Math.floor(group.random() * group.count);
    if (slot < wanted) group.picked[slot] = row;
  });
  const out = [...groups.values()].map((group) => ({
    id: group.id,
    count: group.count,
    samples: shrinkGroup(
      group.picked.map((row) => sampleCells(row)).filter((sample) => Object.keys(sample).length),
      SAMPLE_GROUP_CHARS
    )
  }));
  return shrinkTotal(out);
}
