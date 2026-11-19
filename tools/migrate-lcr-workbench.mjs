/**
 * LCR 计量工作台阶段 1 增量迁移。
 *
 *   node tools/migrate-lcr-workbench.mjs
 *
 * 只补表、补列和索引，不删除现有任务数据。可重复执行。
 */

import { pool, query } from "../server/src/db.js";

async function hasColumn(table, column) {
  const rows = await query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (await hasColumn(table, column)) return;
  await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function hasIndex(table, index) {
  const rows = await query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

await addColumn("rwa_task_sub", "hqla_task_id", "VARCHAR(32) NULL");
await addColumn("rwa_task_sub", "is_required", "TINYINT NOT NULL DEFAULT 0");
await addColumn("rwa_task_sub", "result_summary", "JSON NULL");
await addColumn("rwa_task_sub", "progress", "INT NOT NULL DEFAULT 0");
await addColumn("rwa_task_sub", "review_status", "VARCHAR(16) NOT NULL DEFAULT ''");
if (!(await hasIndex("rwa_task_sub", "idx_rwa_sub_hqla"))) {
  await query("ALTER TABLE rwa_task_sub ADD KEY idx_rwa_sub_hqla (hqla_task_id)");
}

await addColumn("hqla_task", "rwa_task_id", "VARCHAR(32) NULL");
await addColumn("hqla_task", "rwa_task_sub_id", "VARCHAR(32) NULL");
await addColumn("hqla_task", "snapshot_id", "VARCHAR(40) NULL");
await addColumn("hqla_task", "current_run_id", "VARCHAR(40) NULL");
await addColumn("hqla_task", "input_version", "INT NOT NULL DEFAULT 1");
await addColumn("hqla_task", "calc_status", "VARCHAR(16) NOT NULL DEFAULT 'not_run'");
await addColumn("hqla_task", "progress", "INT NOT NULL DEFAULT 0");
await addColumn("hqla_task", "review_status", "VARCHAR(16) NOT NULL DEFAULT ''");
if (!(await hasIndex("hqla_task", "uk_hqla_task_rwa_sub"))) {
  await query("ALTER TABLE hqla_task ADD UNIQUE KEY uk_hqla_task_rwa_sub (rwa_task_sub_id)");
}
if (!(await hasIndex("hqla_task", "idx_hqla_task_rwa_task"))) {
  await query("ALTER TABLE hqla_task ADD KEY idx_hqla_task_rwa_task (rwa_task_id)");
}

await addColumn("hqla_task_dataset", "file_id", "VARCHAR(40) NOT NULL DEFAULT ''");
await addColumn("hqla_task_dataset", "product_group_code", "VARCHAR(64) NOT NULL DEFAULT ''");
await addColumn("hqla_task_dataset", "sample_json", "JSON NULL");
await addColumn("hqla_task_dataset", "profile_json", "JSON NULL");
await addColumn("hqla_task_dataset", "row_count", "INT NOT NULL DEFAULT 0");
await addColumn("hqla_task_dataset", "column_count", "INT NOT NULL DEFAULT 0");
await addColumn("hqla_task_dataset", "parse_status", "VARCHAR(16) NOT NULL DEFAULT 'parsed'");
await addColumn("hqla_task_dataset", "input_version", "INT NOT NULL DEFAULT 1");

const TABLES = [
  `CREATE TABLE IF NOT EXISTS hqla_snapshot (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    snapshot_no INT NOT NULL DEFAULT 1,
    rule_version VARCHAR(40) NOT NULL DEFAULT '',
    jurisdiction CHAR(2) NOT NULL DEFAULT '',
    config_json LONGTEXT NOT NULL,
    config_hash CHAR(64) NOT NULL DEFAULT '',
    created_by VARCHAR(64) NOT NULL DEFAULT '',
    created_at VARCHAR(32) NOT NULL,
    KEY idx_hqla_snapshot_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_file (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    filename VARCHAR(255) NOT NULL DEFAULT '',
    file_hash CHAR(64) NOT NULL DEFAULT '',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    uploaded_by VARCHAR(64) NOT NULL DEFAULT '',
    uploaded_at VARCHAR(32) NOT NULL,
    KEY idx_hqla_file_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_record (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL,
    record_id VARCHAR(128) NOT NULL,
    row_no INT NOT NULL DEFAULT 0,
    raw_json JSON NULL,
    normalized_json JSON NULL,
    product_code VARCHAR(64) NOT NULL DEFAULT '',
    product_group_code VARCHAR(64) NOT NULL DEFAULT '',
    recognition_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    quality_status VARCHAR(16) NOT NULL DEFAULT '',
    calc_status VARCHAR(16) NOT NULL DEFAULT '',
    input_version INT NOT NULL DEFAULT 1,
    UNIQUE KEY uk_hqla_record (task_id, dataset_id, record_id),
    KEY idx_hqla_record_task (task_id),
    KEY idx_hqla_record_product (task_id, product_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_product_rule (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL DEFAULT '',
    strategy_json JSON NULL,
    skill_version VARCHAR(40) NOT NULL DEFAULT '',
    model VARCHAR(80) NOT NULL DEFAULT '',
    prompt_version VARCHAR(40) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'suggested',
    created_at VARCHAR(32) NOT NULL,
    KEY idx_hqla_product_rule_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_product_recognition (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL,
    record_id VARCHAR(128) NOT NULL,
    suggested_product_code VARCHAR(64) NOT NULL DEFAULT '',
    candidate_json JSON NULL,
    confidence DECIMAL(5, 2) NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    method VARCHAR(16) NOT NULL DEFAULT 'AI',
    confirmed_product_code VARCHAR(64) NOT NULL DEFAULT '',
    recognition_status VARCHAR(16) NOT NULL DEFAULT 'pending',
    skill_version VARCHAR(40) NOT NULL DEFAULT '',
    model VARCHAR(80) NOT NULL DEFAULT '',
    prompt_version VARCHAR(40) NOT NULL DEFAULT '',
    input_version INT NOT NULL DEFAULT 1,
    created_at VARCHAR(32) NOT NULL,
    updated_at VARCHAR(32) NOT NULL,
    UNIQUE KEY uk_hqla_product_recognition (task_id, dataset_id, record_id),
    KEY idx_hqla_product_recognition_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_field_suggestion (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL,
    product_code VARCHAR(64) NOT NULL,
    source_column VARCHAR(128) NOT NULL,
    suggested_field_code VARCHAR(64) NOT NULL DEFAULT '',
    confidence DECIMAL(5, 2) NULL,
    reason VARCHAR(500) NOT NULL DEFAULT '',
    method VARCHAR(16) NOT NULL DEFAULT 'AI',
    skill_version VARCHAR(40) NOT NULL DEFAULT '',
    model VARCHAR(80) NOT NULL DEFAULT '',
    prompt_version VARCHAR(40) NOT NULL DEFAULT '',
    input_version INT NOT NULL DEFAULT 1,
    created_at VARCHAR(32) NOT NULL,
    UNIQUE KEY uk_hqla_field_suggestion (task_id, dataset_id, product_code, source_column),
    KEY idx_hqla_field_suggestion_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_field_mapping (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL,
    product_code VARCHAR(64) NOT NULL,
    source_column VARCHAR(128) NOT NULL,
    field_code VARCHAR(64) NOT NULL DEFAULT '',
    required TINYINT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'confirmed',
    confirmed_by VARCHAR(64) NOT NULL DEFAULT '',
    confirmed_at VARCHAR(32) NOT NULL DEFAULT '',
    input_version INT NOT NULL DEFAULT 1,
    UNIQUE KEY uk_hqla_field_mapping (task_id, dataset_id, product_code, source_column),
    KEY idx_hqla_field_mapping_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_quality_run (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    input_version INT NOT NULL DEFAULT 1,
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    summary_json JSON NULL,
    started_at VARCHAR(32) NOT NULL,
    finished_at VARCHAR(32) NOT NULL DEFAULT '',
    KEY idx_hqla_quality_run_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_quality_issue (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(40) NOT NULL,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL DEFAULT '',
    record_id VARCHAR(128) NOT NULL DEFAULT '',
    product_code VARCHAR(64) NOT NULL DEFAULT '',
    row_no INT NOT NULL DEFAULT 0,
    field_code VARCHAR(64) NOT NULL DEFAULT '',
    issue_type VARCHAR(32) NOT NULL DEFAULT '',
    level VARCHAR(8) NOT NULL DEFAULT 'WARN',
    message VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    created_at VARCHAR(32) NOT NULL,
    KEY idx_hqla_quality_issue_run (run_id),
    KEY idx_hqla_quality_issue_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_task_run (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    run_no INT NOT NULL DEFAULT 1,
    snapshot_id VARCHAR(40) NOT NULL DEFAULT '',
    input_version INT NOT NULL DEFAULT 1,
    engine_version VARCHAR(40) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    started_at VARCHAR(32) NOT NULL,
    finished_at VARCHAR(32) NOT NULL DEFAULT '',
    metrics_json JSON NULL,
    stats_json JSON NULL,
    exception_count INT NOT NULL DEFAULT 0,
    created_by VARCHAR(64) NOT NULL DEFAULT '',
    UNIQUE KEY uk_hqla_task_run_no (task_id, run_no),
    KEY idx_hqla_task_run_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_result_detail (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(40) NOT NULL,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL DEFAULT '',
    record_id VARCHAR(128) NOT NULL DEFAULT '',
    product_code VARCHAR(64) NOT NULL DEFAULT '',
    product_name VARCHAR(128) NOT NULL DEFAULT '',
    side VARCHAR(16) NOT NULL DEFAULT '',
    business_id VARCHAR(64) NOT NULL DEFAULT '',
    raw_amount DECIMAL(24, 2) NULL,
    rate_key VARCHAR(64) NOT NULL DEFAULT '',
    rate DECIMAL(12, 6) NULL,
    amount DECIMAL(24, 2) NULL,
    level VARCHAR(16) NOT NULL DEFAULT '',
    category VARCHAR(64) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT '',
    message VARCHAR(255) NOT NULL DEFAULT '',
    detail_json JSON NULL,
    KEY idx_hqla_result_detail_run (run_id),
    KEY idx_hqla_result_detail_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_result_summary (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(40) NOT NULL,
    task_id VARCHAR(32) NOT NULL,
    metric_key VARCHAR(64) NOT NULL,
    metric_name VARCHAR(128) NOT NULL DEFAULT '',
    value DECIMAL(24, 6) NULL,
    unit VARCHAR(24) NOT NULL DEFAULT '',
    detail_json JSON NULL,
    KEY idx_hqla_result_summary_run (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_calculation_exception (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(40) NOT NULL,
    task_id VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(64) NOT NULL DEFAULT '',
    record_id VARCHAR(128) NOT NULL DEFAULT '',
    product_code VARCHAR(64) NOT NULL DEFAULT '',
    level VARCHAR(8) NOT NULL DEFAULT 'WARN',
    code VARCHAR(64) NOT NULL DEFAULT '',
    message VARCHAR(500) NOT NULL DEFAULT '',
    detail_json JSON NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    KEY idx_hqla_calculation_exception_run (run_id),
    KEY idx_hqla_calculation_exception_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_review (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    run_id VARCHAR(40) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    reviewer VARCHAR(64) NOT NULL DEFAULT '',
    comment VARCHAR(1000) NOT NULL DEFAULT '',
    reviewed_at VARCHAR(32) NOT NULL DEFAULT '',
    KEY idx_hqla_review_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS hqla_audit_log (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    object_type VARCHAR(32) NOT NULL DEFAULT '',
    object_id VARCHAR(64) NOT NULL DEFAULT '',
    detail_json JSON NULL,
    actor VARCHAR(64) NOT NULL DEFAULT '',
    at VARCHAR(32) NOT NULL,
    KEY idx_hqla_audit_log_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

for (const sql of TABLES) await query(sql);

await query("UPDATE hqla_task SET input_version = 1 WHERE input_version IS NULL OR input_version = 0");

console.log("LCR 工作台阶段 1 迁移完成");
await pool.end();
