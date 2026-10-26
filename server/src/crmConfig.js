import { pool, query } from "./db.js";

/**
 * 信用风险缓释配置：按产品配置。
 *
 * 产品清单读 product_type，各产品的标准字段清单读 product_field。
 * 配置页第 2 步能绑定的列，只来自该产品标准字段里真实存在的源表列
 * （product_field.source_field），不另立清单。
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

/** 产品清单和标准字段都从库里读，配置只写产品 code 和列名。 */
async function productsWithFields() {
  const products = await query("SELECT code, label, icon, color, rule_version FROM product_type ORDER BY code");
  const fields = await query(
    `SELECT product_code, code, name, meaning, std_field, required, source_system, source_field
     FROM product_field ORDER BY id`
  );
  return products.map((row) => ({
    code: row.code,
    label: row.label,
    icon: row.icon,
    color: row.color,
    ruleVersion: row.rule_version,
    fields: fields
      .filter((field) => field.product_code === row.code)
      .map((field) => ({
        code: field.code,
        name: field.name,
        meaning: field.meaning,
        stdField: field.std_field,
        required: !!field.required,
        sourceSystem: field.source_system,
        sourceField: field.source_field
      }))
  }));
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

export async function readCrmConfig() {
  const [products, configs, columns, types] = await Promise.all([
    productsWithFields(),
    query("SELECT product_code, needed, reason, max_slots FROM crm_product_config"),
    query("SELECT product_code, attr, slot, column_name FROM crm_slot_column ORDER BY product_code, attr, slot"),
    query("SELECT product_code, code, name, note, seq FROM crm_eligible_type ORDER BY product_code, seq, code")
  ]);
  const configOf = new Map(configs.map((row) => [row.product_code, row]));

  const list = products.map((product) => {
    const row = configOf.get(product.code);
    const maxSlots = row ? Number(row.max_slots) : 1;
    const slotColumns = emptySlots(maxSlots);
    columns
      .filter((column) => column.product_code === product.code)
      .forEach((column) => {
        if (!CRM_ATTRS.includes(column.attr)) return;
        slotColumns[column.attr][Number(column.slot) - 1] = column.column_name;
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
      eligibleTypes: types
        .filter((type) => type.product_code === product.code)
        .map((type) => ({ code: type.code, name: type.name, note: type.note || "" }))
    };
  });

  return { maxSlotsLimit: MAX_SLOTS, defaultTypes: DEFAULT_ELIGIBLE_TYPES, products: list };
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
      push.column([product.code, attr, slot, column.slice(0, 80)]);
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

export async function saveCrmConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw fail("config 必须是 JSON 对象");
  if (!Array.isArray(config.products)) throw fail("config 缺少 products 数组");

  const products = await productsWithFields();
  const known = new Map(products.map((product) => [product.code, product]));

  const configRows = [];
  const columnRows = [];
  const typeRows = [];
  const push = {
    config: (row) => configRows.push(row),
    column: (row) => columnRows.push(row),
    type: (row) => typeRows.push(row)
  };

  config.products.forEach((item, index) => {
    const at = "第 " + (index + 1) + " 个产品";
    if (!item || typeof item !== "object") throw fail(at + "不是对象");
    const code = String(item.code || "");
    const product = known.get(code);
    if (!product) throw fail(at + "：产品 " + code + " 不在 product_type 里");
    collect(product.label, product, item, push);
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("DELETE FROM crm_slot_column");
    await connection.query("DELETE FROM crm_eligible_type");
    await connection.query("DELETE FROM crm_product_config");
    if (configRows.length) {
      await connection.query(
        "INSERT INTO crm_product_config (product_code, needed, reason, max_slots) VALUES ?",
        [configRows]
      );
    }
    if (columnRows.length) {
      await connection.query(
        "INSERT INTO crm_slot_column (product_code, attr, slot, column_name) VALUES ?",
        [columnRows]
      );
    }
    if (typeRows.length) {
      await connection.query(
        "INSERT INTO crm_eligible_type (product_code, code, name, note, seq) VALUES ?",
        [typeRows]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  return readCrmConfig();
}
