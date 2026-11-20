import { query } from "./db.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { ruleDocuments, ruleDocument } from "./ruleDocs.js";
import { parameterTables, referenceLists } from "./refData.js";
import { getExposureCache, setExposureCache } from "./exposureCache.js";

export async function exposureOverview({ jurisdiction = "HK", version = "" } = {}) {
  if (!version) {
    const err = new Error("缺少监管规则版本");
    err.status = 400;
    throw err;
  }
  const versionId = await resolveVersionRef(version, jurisdiction);
  if (!versionId) {
    const err = new Error("监管规则版本不存在");
    err.status = 404;
    throw err;
  }
  const cached = getExposureCache(versionId);
  if (cached) return cached;

  const [versionRows, docs, tables, lists] = await Promise.all([
    query("SELECT id, jurisdiction, version, name, status, revision, config_status, published_snapshot_id, updated_at FROM rule_version WHERE id = ?", [versionId]),
    ruleDocuments({ jurisdiction, version }),
    parameterTables(jurisdiction, version),
    referenceLists(jurisdiction, version)
  ]);
  const row = versionRows[0];
  if (!row) {
    const err = new Error("监管规则版本不存在");
    err.status = 404;
    throw err;
  }
  const classMeta = docs.find((item) => item.kind === "exposure_classification") || null;
  const weightMeta = docs.find((item) => item.kind === "risk_weight") || null;
  const [classDoc, weightDoc] = await Promise.all([
    classMeta ? ruleDocument(classMeta.id) : Promise.resolve(null),
    weightMeta ? ruleDocument(weightMeta.id) : Promise.resolve(null)
  ]);
  const data = {
    version: {
      id: row.id,
      jurisdiction: row.jurisdiction,
      version: row.version,
      name: row.name,
      status: row.status,
      revision: Number(row.revision) || 1,
      configStatus: row.config_status || "",
      publishedSnapshotId: row.published_snapshot_id || "",
      updatedAt: row.updated_at || ""
    },
    docs,
    classification: classDoc ? classDoc.body : null,
    weight: weightDoc ? weightDoc.body : null,
    tables,
    lists
  };
  setExposureCache(versionId, data);
  return data;
}
