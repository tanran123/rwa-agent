import { pool, query } from "./db.js";
import { configProducts } from "./productStandard.js";
import { resolveVersionRef } from "./ruleVersion.js";
import { assertRevision, assertVersionWritable, latestConfigRevision, recordRevision } from "./configAudit.js";

/**
 * 信用风险缓释配置：按产品配置。
 *
 * 产品清单和各产品的标准字段清单来自产品标准字段配置写入的产品注册；
 * 历史版本还没有产品注册时回退到 product_type / product_field。
 * 配置页第 2 步能绑定的列，只来自该产品标准字段里真实存在的源表列。
 */

/** 缓释配置只绑定这三个属性。 */
export const CRM_ATTRS = ["crm_type", "crm_value", "crm_weight"];

/** 一笔债项最多挂几笔缓释物。 */
export const MAX_SLOTS = 6;

/** 合格缓释物字典的默认骨架。页面的「恢复默认」用它，与 seed 里灌的那份一致。 */
export const DEFAULT_ELIGIBLE_TYPES = [
  {
    code: "cash",
    name: "现金及本机构发行的存款证",
    note: "现金，以及由承担该交易对手暴露的填報機構本身所發行之存款證或類似工具，存放於該填報機構。（第 80(a) 段）"
  },
  { code: "gold", name: "黄金", note: "黄金。（第 80(b) 段）" },
  {
    code: "gov_bond",
    name: "主权债务证券",
    note: "由主權發行、且信用品質級別為第 4 級或以上的債務證券。（第 80(c) 段）"
  },
  {
    code: "pse_bond",
    name: "公共部门实体债务证券",
    note: "由公共部門實體（PSEs）發行、且信用品質級別為第 4 級或以上的債務證券。（第 80(d) 段）"
  },
  {
    code: "guarantee",
    name: "第三方保证",
    note: "由合格保證人（主權、PSE、銀行，或其他風險權重為 20% 或更佳且低於交易對手風險權重之實體）提供之保證。（第 84–85 段）"
  }
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const PLACEHOLDER = new Set(["", "—", "-", "－"]);

/**
 * 这个标准字段是不是一条真实存在的源表列。
 * 计算字段不算源表列 —— 库里这类字段的 source_system 就是「计算字段」，
 * source_field 是占位符，两条都挡得住，不再另做算式识别。
 */
function isSourceColumn(field) {
  if (PLACEHOLDER.has(String(field.sourceField || "").trim())) return false;
  if (field.sourceSystem === "计算字段") return false;
  return true;
}

/** 可绑定的源表列，按来源系统分组，下拉框用 optgroup 呈现。 */
function sourceColumnsOf(fields) {
  const bySystem = new Map();
  fields.forEach((field) => {
    if (!isSourceColumn(field)) return;
    const column = String(field.sourceField).trim();
    const system = field.sourceSystem || "未标注来源";
    if (!bySystem.has(system)) bySystem.set(system, new Set());
    bySystem.get(system).add(column);
  });
  const groups = Array.from(bySystem.entries()).map(([label, set]) => ({
    label,
    columns: Array.from(set)
  }));
  return { groups, flat: groups.reduce((all, group) => all.concat(group.columns), []) };
}

/** 空绑定一律补成 maxSlots 长的数组，页面对位取用。 */
function emptySlots(maxSlots) {
  const slots = {};
  CRM_ATTRS.forEach((attr) => {
    slots[attr] = Array.from({ length: maxSlots }, () => "");
  });
  return slots;
}

export async function readCrmConfig({ version = "", jurisdiction = "" } = {}) {
  const versionId = version ? await resolveVersionRef(version, jurisdiction) : "";
  const [products, configs, columns, types] = await Promise.all([
    configProducts(version),
    query(
      versionId
        ? "SELECT product_code, needed, reason, max_slots, rule_version_id FROM crm_product_config WHERE rule_version_id = ? OR rule_version_id = ''"
        : "SELECT product_code, needed, reason, max_slots, rule_version_id FROM crm_product_config",
      versionId ? [versionId] : []
    ),
    query(
      versionId
        ? "SELECT product_code, attr, slot, column_name, target_fact_code, rule_version_id FROM crm_slot_column WHERE rule_version_id = ? OR rule_version_id = '' ORDER BY product_code, attr, slot"
        : "SELECT product_code, attr, slot, column_name, target_fact_code, rule_version_id FROM crm_slot_column ORDER BY product_code, attr, slot",
      versionId ? [versionId] : []
    ),
    query(
      versionId
        ? "SELECT product_code, code, name, note, seq, rule_version_id FROM crm_eligible_type WHERE rule_version_id = ? OR rule_version_id = '' ORDER BY product_code, seq, code"
        : "SELECT product_code, code, name, note, seq, rule_version_id FROM crm_eligible_type ORDER BY product_code, seq, code",
      versionId ? [versionId] : []
    )
  ]);

  function rowOf(list, code) {
    return (versionId ? list.find((row) => row.product_code === code && row.rule_version_id === versionId) : null)
      || list.find((row) => row.product_code === code && !row.rule_version_id)
      || null;
  }

  const list = products.map((product) => {
    const row = rowOf(configs, product.code);
    const ownVersion = row ? (row.rule_version_id || "") : "";
    const maxSlots = row ? Number(row.max_slots) : 1;
    const slotColumns = emptySlots(maxSlots);
    const slotFactCodes = emptySlots(maxSlots);
    columns
      .filter((column) => column.product_code === product.code && (column.rule_version_id || "") === ownVersion)
      .forEach((column) => {
        if (!CRM_ATTRS.includes(column.attr)) return;
        slotColumns[column.attr][Number(column.slot) - 1] = column.column_name;
        slotFactCodes[column.attr][Number(column.slot) - 1] = column.target_fact_code || column.attr;
      });

    return {
      code: product.code,
      label: product.label,
      icon: product.icon,
      color: product.color,
      ruleVersion: product.ruleVersion,
      fields: product.fields,
      sourceColumns: sourceColumnsOf(product.fields),
      needed: row ? !!Number(row.needed) : false,
      reason: row ? row.reason || "" : "",
      maxSlots,
      slotColumns,
      slotFactCodes,
      eligibleTypes: types
        .filter((type) => type.product_code === product.code && (type.rule_version_id || "") === ownVersion)
        .map((type) => ({ code: type.code, name: type.name, note: type.note || "" }))
    };
  });

  return {
    version: version || "",
    ruleVersionId: versionId,
    configRevision: versionId ? await latestConfigRevision(versionId, "crm_config") : 0,
    maxSlotsLimit: MAX_SLOTS,
    defaultTypes: DEFAULT_ELIGIBLE_TYPES,
    products: list
  };
}

/** 合格缓释物字典的校验。与「是否需要配置」无关，两种状态都保存。 */
function collectTypes(name, product, item, push) {
  const types = Array.isArray(item.eligibleTypes) ? item.eligibleTypes : [];
  const seenTypes = new Set();
  types.forEach((type, order) => {
    const typeCode = String((type && type.code) || "").trim();
    const typeName = String((type && type.name) || "").trim();
    if (!typeCode) throw fail(name + "：第 " + (order + 1) + " 条合格缓释物没填类型编码");
    if (!typeName) throw fail(name + "：类型编码「" + typeCode + "」没填名称");
    if (seenTypes.has(typeCode)) throw fail(name + "：合格缓释物类型编码重复：" + typeCode);
    seenTypes.add(typeCode);
    push.type([
      product.code, typeCode.slice(0, 32), typeName.slice(0, 128),
      String((type && type.note) || "").slice(0, 255), order + 1
    ]);
  });
  return types.length;
}

/** 校验一个产品的绑定和字典，通过则把行推进三个数组。 */
function collect(name, product, item, push) {
  const available = sourceColumnsOf(product.fields).flat;
  const availableSet = new Set(available);

  const needed = item.needed !== false;
  const reason = String(item.reason || "").slice(0, 255);

  // 字典与「是否需要配置」无关：标为无需配置也照样保存，切回来时不用重配。
  const typeCount = collectTypes(name, product, item, push);

  if (!needed) {
    push.config([product.code, 0, reason, 1]);
    return;
  }

  const maxSlots = Number(item.maxSlots);
  if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > MAX_SLOTS) {
    throw fail(name + "：最多支持笔数只能填 1–" + MAX_SLOTS);
  }

  const raw = item.slotColumns && typeof item.slotColumns === "object" ? item.slotColumns : {};
  Object.keys(raw).forEach((attr) => {
    if (!CRM_ATTRS.includes(attr)) throw fail(name + "：不认识的缓释属性 " + attr);
  });

  /** 页面绑定的源列 → 计算引擎读取的标准事实编码。缺省用属性名。 */
  const rawFacts = item.slotFactCodes && typeof item.slotFactCodes === "object" ? item.slotFactCodes : {};
  const factCodes = {};
  CRM_ATTRS.forEach((attr) => {
    const list = Array.isArray(rawFacts[attr]) ? rawFacts[attr] : [];
    factCodes[attr] = Array.from({ length: maxSlots }, (_, index) => String(list[index] || "").trim() || attr);
  });

  /** 三个属性、每一笔都取出来，按 maxSlots 对齐。 */
  const slots = {};
  CRM_ATTRS.forEach((attr) => {
    const list = Array.isArray(raw[attr]) ? raw[attr] : [];
    slots[attr] = Array.from({ length: maxSlots }, (_, index) => String(list[index] || "").trim());
  });

  // 三个属性都是必选：第 1 笔必须填满，其余笔要么整笔留空、要么三个都填。
  for (let slot = 1; slot <= maxSlots; slot += 1) {
    const filled = CRM_ATTRS.filter((attr) => slots[attr][slot - 1]);
    const mustFill = slot === 1 && available.length > 0;
    if (!filled.length && !mustFill) continue;
    const missing = CRM_ATTRS.filter((attr) => !slots[attr][slot - 1]);
    if (missing.length) {
      throw fail(
        name + "：第 " + slot + " 笔的「" + missing.join("」「") + "」还没选列名。" +
        "三个属性都是必选，" + (filled.length ? "同一笔要么三个都填，要么整笔留空。" : "第 1 笔必须填满。")
      );
    }
  }

  CRM_ATTRS.forEach((attr) => {
    const used = new Set();
    for (let slot = 1; slot <= maxSlots; slot += 1) {
      const column = slots[attr][slot - 1];
      if (!column) continue;
      if (!availableSet.has(column)) {
        throw fail(
          name + "：第 " + slot + " 笔的「" + attr + "」填了「" + column +
          "」，不在本产品标准字段维护的源表列里（可选 " + available.length + " 列）"
        );
      }
      if (used.has(column)) throw fail(name + "：「" + attr + "」的列名重复：" + column);
      used.add(column);
      push.column([product.code, attr, slot, column.slice(0, 80), (factCodes[attr][slot - 1] || attr).slice(0, 40)]);
    }
  });

  // 同一笔内不同属性不能指向同一个源表列
  for (let slot = 1; slot <= maxSlots; slot += 1) {
    const seen = new Map();
    CRM_ATTRS.forEach((attr) => {
      const column = slots[attr][slot - 1];
      if (!column) return;
      if (seen.has(column)) {
        throw fail(
          name + "：第 " + slot + " 笔的「" + seen.get(column) + "」与「" + attr +
          "」填了同一个列名「" + column + "」"
        );
      }
      seen.set(column, attr);
    });
  }

  const bound = CRM_ATTRS.some((attr) => slots[attr].some((value) => value));
  if (bound && !typeCount) throw fail(name + "：已绑定缓释字段，但合格缓释物字典为空");

  push.config([product.code, 1, reason, maxSlots]);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

export async function saveCrmConfig(config, { version = "", jurisdiction = "", actor = "" } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw fail("config 必须是 JSON 对象");
  if (!Array.isArray(config.products)) throw fail("config 缺少 products 数组");

  const configVersion = String(config.version || version || "").trim();
  if (!configVersion) throw fail("缺少监管版本，不能保存缓释配置");
  const versionId = await resolveVersionRef(configVersion, jurisdiction);
  if (!versionId) throw fail("找不到监管版本 " + configVersion);

  await assertVersionWritable(versionId);
  const currentRevision = await latestConfigRevision(versionId, "crm_config");
  assertRevision(currentRevision, config.baseRevision != null ? config.baseRevision : options.baseRevision, "缓释配置");
  const products = await configProducts(configVersion);
  if (!products.length) throw fail("当前监管版本没有产品注册，不能保存缓释配置");
  const known = new Map(products.map((product) => [product.code, product]));

  const configRows = [];
  const columnRows = [];
  const typeRows = [];
  const push = {
    config: (row) => configRows.push([versionId, ...row]),
    column: (row) => columnRows.push([versionId, ...row]),
    type: (row) => typeRows.push([versionId, ...row])
  };

  config.products.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const code = String(item.code || "");
    const product = known.get(code);
    // 只保存当前监管版本的产品，其它版本的产品不动。
    if (!product) return;
    collect(product.label, product, item, push);
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const row of configRows) {
      const [, code, needed, reason, maxSlots] = row;
      await connection.query(
        `INSERT INTO crm_product_config
           (rule_version_id, product_code, needed, reason, max_slots, decision_status, revision, status, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'APPROVED', ?, ?)
         ON DUPLICATE KEY UPDATE
           needed = VALUES(needed), reason = VALUES(reason), max_slots = VALUES(max_slots),
           decision_status = VALUES(decision_status), revision = revision + 1,
           status = VALUES(status), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
        [versionId, code, needed, reason, maxSlots, needed ? "REQUIRED" : "NOT_REQUIRED", actor, stamp()]
      );
      await connection.query(
        "DELETE FROM crm_slot_column WHERE rule_version_id = ? AND product_code = ?",
        [versionId, code]
      );
      await connection.query(
        "DELETE FROM crm_eligible_type WHERE rule_version_id = ? AND product_code = ?",
        [versionId, code]
      );
      const columns = columnRows.filter((item) => item[1] === code);
      const types = typeRows.filter((item) => item[1] === code);
      if (columns.length) {
        await connection.query(
          "INSERT INTO crm_slot_column (rule_version_id, product_code, attr, slot, column_name, target_fact_code) VALUES ?",
          [columns]
        );
      }
      if (types.length) {
        await connection.query(
          "INSERT INTO crm_eligible_type (rule_version_id, product_code, code, name, note, seq, clause_id, status) VALUES ?",
          [types.map((item) => item.concat(["", "ACTIVE"]))]
        );
      }
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await recordRevision({
    ruleVersionId: versionId, objectType: "crm_config", objectKey: "all", action: "UPDATE",
    before: { revision: currentRevision },
    after: { products: configRows.map((row) => ({ code: row[1], needed: row[2], maxSlots: row[4] })) },
    actor
  });
  return readCrmConfig({ version: configVersion, jurisdiction });
}
