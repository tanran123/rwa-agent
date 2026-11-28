-- 信用风险 RWA 产品库
-- 先执行本文件，再执行 002_seed.sql
-- mysql -u root -p < sql/001_schema.sql

CREATE DATABASE IF NOT EXISTS rwa
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE rwa;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS product_group_decision_audit;
DROP TABLE IF EXISTS product_group_constraint;
DROP TABLE IF EXISTS product_group_proposal;
DROP TABLE IF EXISTS product_group_run;
DROP TABLE IF EXISTS assistant_turn;
DROP TABLE IF EXISTS rwa_task_sub;
DROP TABLE IF EXISTS rwa_task;
DROP TABLE IF EXISTS measure_line;
DROP TABLE IF EXISTS measure_batch;
DROP TABLE IF EXISTS rule_config_snapshot_item;
DROP TABLE IF EXISTS rule_config_snapshot;
DROP TABLE IF EXISTS config_revision;
DROP TABLE IF EXISTS rule_clause_relation;
DROP TABLE IF EXISTS product_exposure_rule;
DROP TABLE IF EXISTS crm_eligible_type;
DROP TABLE IF EXISTS crm_slot_column;
DROP TABLE IF EXISTS crm_product_config;
DROP TABLE IF EXISTS crm_rule;
DROP TABLE IF EXISTS ccf_rule;
DROP TABLE IF EXISTS ead_product_rule;
DROP TABLE IF EXISTS ead_product_config;
DROP TABLE IF EXISTS ead_rule;
DROP TABLE IF EXISTS mo_weight_row;
DROP TABLE IF EXISTS bank_grade_row;
DROP TABLE IF EXISTS weight_rule;
DROP TABLE IF EXISTS rule_list;
DROP TABLE IF EXISTS rule_parameter_table;
DROP TABLE IF EXISTS rule_document;
DROP TABLE IF EXISTS exposure_document;
DROP TABLE IF EXISTS field_mapping;
DROP TABLE IF EXISTS product_field;
DROP TABLE IF EXISTS product_type;
DROP TABLE IF EXISTS clause_ref;
DROP TABLE IF EXISTS clause_doc;
DROP TABLE IF EXISTS rule_version;
DROP TABLE IF EXISTS org_unit;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS jurisdiction;
DROP TABLE IF EXISTS hqla_task_input;
DROP TABLE IF EXISTS hqla_task_list;
DROP TABLE IF EXISTS hqla_task_reported;
DROP TABLE IF EXISTS hqla_task_dataset;
DROP TABLE IF EXISTS hqla_record;
DROP TABLE IF EXISTS hqla_file;
DROP TABLE IF EXISTS hqla_snapshot;
DROP TABLE IF EXISTS hqla_product_rule;
DROP TABLE IF EXISTS hqla_product_recognition;
DROP TABLE IF EXISTS hqla_field_suggestion;
DROP TABLE IF EXISTS hqla_field_mapping;
DROP TABLE IF EXISTS hqla_quality_run;
DROP TABLE IF EXISTS hqla_quality_issue;
DROP TABLE IF EXISTS hqla_task_run;
DROP TABLE IF EXISTS hqla_result_detail;
DROP TABLE IF EXISTS hqla_result_summary;
DROP TABLE IF EXISTS hqla_calculation_exception;
DROP TABLE IF EXISTS hqla_review;
DROP TABLE IF EXISTS hqla_audit_log;
DROP TABLE IF EXISTS hqla_task;
DROP TABLE IF EXISTS hqla_reference;
DROP TABLE IF EXISTS liquidity_product_field;
DROP TABLE IF EXISTS liquidity_product_group;
DROP TABLE IF EXISTS liquidity_field_group;
DROP TABLE IF EXISTS liquidity_dictionary_item;
DROP TABLE IF EXISTS liquidity_dictionary;
DROP TABLE IF EXISTS liquidity_rule_scope;
DROP TABLE IF EXISTS liquidity_product;
DROP TABLE IF EXISTS liquidity_rule;
DROP TABLE IF EXISTS liquidity_param_table;
DROP TABLE IF EXISTS liquidity_param;
DROP TABLE IF EXISTS liquidity_list;
DROP TABLE IF EXISTS liquidity_config_meta;
DROP TABLE IF EXISTS token_log;
DROP TABLE IF EXISTS llm_config;
DROP TABLE IF EXISTS operation_log;
DROP TABLE IF EXISTS login_log;
DROP TABLE IF EXISTS app_user;
DROP TABLE IF EXISTS app_role;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE jurisdiction (
  code CHAR(2) NOT NULL PRIMARY KEY,
  label VARCHAR(32) NOT NULL,
  regulator VARCHAR(128) NOT NULL,
  currency CHAR(3) NOT NULL,
  currency_label VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  code VARCHAR(16) NOT NULL,
  category VARCHAR(16) NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE org_unit (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  jurisdiction CHAR(2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rule_version (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  version VARCHAR(40) NOT NULL,
  name VARCHAR(128) NOT NULL,
  rule_type VARCHAR(32) NOT NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  status VARCHAR(20) NOT NULL,
  institution VARCHAR(64) NOT NULL,
  ruleset_file VARCHAR(64) NOT NULL,
  published_at VARCHAR(32) NOT NULL,
  author VARCHAR(64) NOT NULL,
  changelog TEXT NOT NULL,
  framework VARCHAR(16) NOT NULL DEFAULT 'CAR',
  source_version_id VARCHAR(40) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  config_status VARCHAR(16) NOT NULL DEFAULT 'EMPTY',
  validated_at VARCHAR(32) NOT NULL DEFAULT '',
  published_snapshot_id VARCHAR(40) NOT NULL DEFAULT '',
  KEY idx_rule_version_jur (jurisdiction, status),
  KEY idx_rule_version_framework (framework, config_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE clause_doc (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  doc VARCHAR(128) NOT NULL,
  doc_version VARCHAR(32) NOT NULL,
  clause_no VARCHAR(32) NOT NULL,
  title VARCHAR(128) NOT NULL,
  body TEXT NOT NULL,
  scope VARCHAR(255) NOT NULL,
  effective_from DATE NULL,
  source VARCHAR(255) NOT NULL,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  framework VARCHAR(16) NOT NULL DEFAULT 'CAR',
  clause_code VARCHAR(32) NOT NULL DEFAULT '',
  regulation_name VARCHAR(128) NOT NULL DEFAULT '',
  regulation_version VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  revision INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_clause_jur (jurisdiction),
  KEY idx_clause_version (rule_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE clause_ref (
  clause_id VARCHAR(32) NOT NULL,
  rule_name VARCHAR(80) NOT NULL,
  PRIMARY KEY (clause_id, rule_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_type (
  code VARCHAR(32) NOT NULL PRIMARY KEY,
  label VARCHAR(64) NOT NULL,
  icon VARCHAR(8) NOT NULL,
  color VARCHAR(16) NOT NULL,
  description VARCHAR(255) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  onboarding VARCHAR(16) NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  source_system VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_field (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  meaning VARCHAR(255) NOT NULL,
  data_type VARCHAR(16) NOT NULL,
  unit VARCHAR(16) NOT NULL DEFAULT '',
  required TINYINT NOT NULL DEFAULT 0,
  source_system VARCHAR(80) NOT NULL,
  source_field VARCHAR(80) NOT NULL,
  transform_rule VARCHAR(255) NOT NULL,
  validate_rule VARCHAR(255) NOT NULL,
  options_json JSON NOT NULL,
  referenced_json JSON NOT NULL,
  std_field VARCHAR(64) NULL,
  UNIQUE KEY uk_product_field (product_code, code),
  KEY idx_product_field_prod (product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE field_mapping (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  std_field VARCHAR(64) NOT NULL,
  std_code VARCHAR(64) NOT NULL,
  src_system VARCHAR(80) NOT NULL,
  src_field VARCHAR(80) NOT NULL,
  via VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL,
  hit_rate DECIMAL(6, 4) NOT NULL DEFAULT 0,
  sample VARCHAR(255) NOT NULL DEFAULT '',
  KEY idx_field_mapping_prod (product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE exposure_document (
  id INT NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  title VARCHAR(64) NOT NULL,
  label VARCHAR(64) NOT NULL DEFAULT '',
  seq INT NOT NULL DEFAULT 0,
  source_file VARCHAR(160) NOT NULL,
  rule_version VARCHAR(40) NOT NULL DEFAULT '',
  body JSON NOT NULL,
  UNIQUE KEY uq_exposure_document_name (name),
  KEY idx_exposure_document_version (rule_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- V3.4 规则配置文件：一份文档一行，按监管版本区分。
-- kind 取值 exposure_classification / risk_weight / product_registry / data_mapping，
-- 与文档自身的 rule_type 对应；product_registry 和 data_mapping 见配套规范 02。
CREATE TABLE rule_document (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  doc_version VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  title VARCHAR(255) NOT NULL,
  body JSON NOT NULL,
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  content_hash CHAR(64) NOT NULL DEFAULT '',
  UNIQUE KEY uk_rule_document (jurisdiction, rule_version, kind, name),
  KEY idx_rule_document_version (jurisdiction, rule_version, kind),
  KEY idx_rule_document_vid (rule_version_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 监管参数表：规则集通过 table_id 引用，正文按 columns_json 的顺序存 rows_json。
CREATE TABLE rule_parameter_table (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  table_id VARCHAR(64) NOT NULL,
  table_version VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'regulatory_parameter',
  columns_json JSON NOT NULL,
  rows_json JSON NOT NULL,
  note TEXT NOT NULL,
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  UNIQUE KEY uk_rule_parameter (rule_version_id, table_id, table_version),
  KEY idx_rule_parameter_jur (jurisdiction)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 监管名单：规则集通过 list_id 引用，名单条目按 columns_json 的顺序存 rows_json。
CREATE TABLE rule_list (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  list_id VARCHAR(64) NOT NULL,
  list_version VARCHAR(32) NOT NULL,
  title VARCHAR(255) NOT NULL,
  list_type VARCHAR(16) NOT NULL DEFAULT 'positive',
  columns_json JSON NOT NULL,
  rows_json JSON NOT NULL,
  note TEXT NOT NULL,
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  UNIQUE KEY uk_rule_list (rule_version_id, list_id, list_version),
  KEY idx_rule_list_jur (jurisdiction)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 配置修订留痕：对象类型 + 对象键 + 修订号，保存修改前后摘要。
CREATE TABLE config_revision (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  object_type VARCHAR(40) NOT NULL,
  object_key VARCHAR(160) NOT NULL DEFAULT '',
  revision INT NOT NULL DEFAULT 1,
  action VARCHAR(16) NOT NULL DEFAULT 'UPDATE',
  before_json JSON NULL,
  after_json JSON NULL,
  actor VARCHAR(64) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  KEY idx_config_revision_object (rule_version_id, object_type, object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 发布快照：版本发布时冻结全部影响计量的配置。
CREATE TABLE rule_config_snapshot (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL,
  jurisdiction CHAR(2) NOT NULL DEFAULT '',
  framework VARCHAR(16) NOT NULL DEFAULT 'CAR',
  version VARCHAR(40) NOT NULL DEFAULT '',
  snapshot_no INT NOT NULL DEFAULT 1,
  config_hash CHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  KEY idx_rule_snapshot_version (rule_version_id, snapshot_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rule_config_snapshot_item (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  snapshot_id VARCHAR(40) NOT NULL,
  object_type VARCHAR(40) NOT NULL,
  object_key VARCHAR(160) NOT NULL DEFAULT '',
  content_json LONGTEXT NOT NULL,
  content_hash CHAR(64) NOT NULL DEFAULT '',
  KEY idx_rule_snapshot_item (snapshot_id, object_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 规则节点与条款的结构化引用，替代只存自由文本的 clause_ref。
CREATE TABLE rule_clause_relation (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  rule_document_id VARCHAR(120) NOT NULL DEFAULT '',
  rule_node_id VARCHAR(120) NOT NULL DEFAULT '',
  clause_id VARCHAR(32) NOT NULL,
  relation_type VARCHAR(24) NOT NULL DEFAULT 'REFERENCE',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_rule_clause_relation (rule_version_id, rule_document_id),
  KEY idx_rule_clause_clause (clause_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE weight_rule (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  class_name VARCHAR(64) NOT NULL,
  cond_text VARCHAR(255) NOT NULL,
  risk_weight VARCHAR(32) NOT NULL,
  priority INT NOT NULL,
  bank_tier VARCHAR(16) NOT NULL,
  basis VARCHAR(255) NOT NULL,
  KEY idx_weight_class (class_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bank_grade_row (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  label VARCHAR(64) NOT NULL,
  priority INT NOT NULL,
  basis VARCHAR(128) NOT NULL,
  weights_json JSON NOT NULL,
  ids_json JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mo_weight_row (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  bucket VARCHAR(64) NOT NULL,
  weights_json JSON NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 表内 / 表外 EAD 计算配置，一个产品一行。
-- side 只在这张表上，规则表不带 side，所以同一产品不可能表内表外都有规则。
CREATE TABLE ead_product_config (
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  product_code VARCHAR(32) NOT NULL,
  needed TINYINT NOT NULL DEFAULT 1,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  side ENUM('on', 'off') NULL,
  version VARCHAR(40) NOT NULL DEFAULT '',
  decision_status VARCHAR(16) NOT NULL DEFAULT 'UNDECIDED',
  revision INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  PRIMARY KEY (rule_version_id, product_code),
  KEY idx_ead_config_product (product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 一个产品下的 EAD 规则，seq 自上而下，第一条命中生效。
CREATE TABLE ead_product_rule (
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  id VARCHAR(32) NOT NULL,
  product_code VARCHAR(32) NOT NULL,
  seq INT NOT NULL DEFAULT 1,
  name VARCHAR(128) NOT NULL,
  condition_text VARCHAR(255) NOT NULL DEFAULT '',
  conditions_json JSON NOT NULL,
  formula VARCHAR(512) NOT NULL,
  fields_json JSON NOT NULL,
  structured_json JSON NOT NULL,
  precision_digits TINYINT NOT NULL DEFAULT 2,
  rounding VARCHAR(20) NOT NULL DEFAULT '四舍五入',
  result_field VARCHAR(64) NOT NULL,
  clause_id VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  ccf DECIMAL(8, 4) NULL,
  params_json JSON NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  PRIMARY KEY (rule_version_id, id),
  UNIQUE KEY uk_ead_product_rule (rule_version_id, product_code, seq),
  KEY idx_ead_product_rule (product_code, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ccf_rule (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  type_name VARCHAR(128) NOT NULL,
  cond_text VARCHAR(255) NOT NULL,
  ccf VARCHAR(16) NOT NULL,
  priority INT NOT NULL,
  conds_json JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_rule (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  type_name VARCHAR(32) NOT NULL,
  tool VARCHAR(255) NOT NULL,
  substitute VARCHAR(32) NOT NULL,
  floor_param VARCHAR(32) NOT NULL DEFAULT '',
  constraints_json JSON NOT NULL,
  priority INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 信用风险缓释配置：按产品配置。产品清单读 product_type，可选源表列读 product_field。
CREATE TABLE crm_product_config (
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  product_code VARCHAR(32) NOT NULL,
  needed TINYINT NOT NULL DEFAULT 1,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  max_slots TINYINT NOT NULL DEFAULT 1,
  decision_status VARCHAR(16) NOT NULL DEFAULT 'UNDECIDED',
  revision INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'APPROVED',
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  PRIMARY KEY (rule_version_id, product_code),
  KEY idx_crm_config_product (product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 逐笔列名绑定。attr 只有 crm_type / crm_value / crm_weight 三个值；
-- target_fact_code 是计算引擎读取的标准事实编码。
CREATE TABLE crm_slot_column (
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  product_code VARCHAR(32) NOT NULL,
  attr VARCHAR(16) NOT NULL,
  slot TINYINT NOT NULL,
  column_name VARCHAR(80) NOT NULL,
  target_fact_code VARCHAR(40) NOT NULL DEFAULT '',
  PRIMARY KEY (rule_version_id, product_code, attr, slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 产品的合格缓释物字典。字典外的类型视为不合格，缓释不予认定。
CREATE TABLE crm_eligible_type (
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  product_code VARCHAR(32) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  seq INT NOT NULL DEFAULT 1,
  clause_id VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (rule_version_id, product_code, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_exposure_rule (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  rule_name VARCHAR(64) NOT NULL,
  label VARCHAR(128) NOT NULL,
  priority INT NOT NULL,
  version VARCHAR(40) NOT NULL,
  when_text VARCHAR(255) NOT NULL,
  target_class VARCHAR(64) NOT NULL,
  target_sub VARCHAR(80) NOT NULL,
  weight_text VARCHAR(80) NOT NULL,
  clause_id VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL,
  KEY idx_product_rule (product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 信用风险 RWA：主任务 = 一个季度的计量任务。监管版本和机构在创建时固定，
-- 子任务只记暴露类型和归档批次，版本和机构随主任务。
CREATE TABLE rwa_task (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  institution VARCHAR(64) NOT NULL DEFAULT '',
  jurisdiction CHAR(2) NOT NULL,
  version VARCHAR(40) NOT NULL,
  base_date DATE NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  snapshot_id VARCHAR(40) NOT NULL DEFAULT '',
  KEY idx_rwa_task_updated (updated_at),
  KEY idx_rwa_task_version (rule_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 主任务下的子任务。module 区分资本充足率和流动性两大工作模块。
-- 资本充足率子任务由计量向导执行，完成时把批次写回 batch_id；流动性子任务在流动性页签执行。
CREATE TABLE rwa_task_sub (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  module VARCHAR(16) NOT NULL DEFAULT 'capital',
  name VARCHAR(200) NOT NULL,
  exposure_type VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  batch_id VARCHAR(40) NULL,
  batch_name VARCHAR(128) NOT NULL DEFAULT '',
  hqla_task_id VARCHAR(32) NULL,
  is_required TINYINT NOT NULL DEFAULT 0,
  result_summary JSON NULL,
  progress INT NOT NULL DEFAULT 0,
  review_status VARCHAR(16) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  KEY idx_rwa_sub_task (task_id),
  KEY idx_rwa_sub_hqla (hqla_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE measure_batch (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  institution VARCHAR(64) NOT NULL,
  jurisdiction CHAR(2) NOT NULL,
  version VARCHAR(40) NOT NULL,
  base_date DATE NOT NULL,
  imported INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  exception_count INT NOT NULL DEFAULT 0,
  on_ead DECIMAL(20, 2) NOT NULL DEFAULT 0,
  off_ead DECIMAL(20, 2) NOT NULL DEFAULT 0,
  ead DECIMAL(20, 2) NOT NULL DEFAULT 0,
  rwa DECIMAL(20, 2) NOT NULL DEFAULT 0,
  created_at VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL,
  rules_json JSON NULL,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  snapshot_id VARCHAR(40) NOT NULL DEFAULT '',
  engine_version VARCHAR(40) NOT NULL DEFAULT '',
  KEY idx_batch_date (base_date),
  KEY idx_batch_version (rule_version_id),
  UNIQUE KEY uq_measure_batch_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE measure_line (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  batch_id VARCHAR(40) NOT NULL,
  loan_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(128) NOT NULL DEFAULT '',
  product_code VARCHAR(32) NOT NULL DEFAULT '',
  exposure_class VARCHAR(64) NOT NULL DEFAULT '',
  weight_text VARCHAR(32) NOT NULL DEFAULT '',
  ead DECIMAL(20, 2) NOT NULL DEFAULT 0,
  rwa DECIMAL(20, 2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'ok',
  detail JSON NULL,
  KEY idx_line_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE assistant_turn (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  seq INT NOT NULL,
  role VARCHAR(16) NOT NULL,
  body JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 流动性 HQLA：一个计算任务 = 一次独立判定作业
CREATE TABLE hqla_task (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  institution VARCHAR(64) NOT NULL DEFAULT '',
  base_date DATE NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  step TINYINT NOT NULL DEFAULT 1,
  config JSON NULL,
  sample JSON NULL,
  fetch_log JSON NULL,
  summary JSON NULL,
  reported JSON NULL,
  input_meta JSON NULL,
  ref_meta JSON NULL,
  fetch_sig VARCHAR(255) NULL,
  frozen_at VARCHAR(32) NULL,
  frozen_sig VARCHAR(255) NULL,
  run_at VARCHAR(32) NULL,
  rwa_task_id VARCHAR(32) NULL,
  rwa_task_sub_id VARCHAR(32) NULL,
  snapshot_id VARCHAR(40) NULL,
  current_run_id VARCHAR(40) NULL,
  input_version INT NOT NULL DEFAULT 1,
  calc_status VARCHAR(16) NOT NULL DEFAULT 'not_run',
  progress INT NOT NULL DEFAULT 0,
  review_status VARCHAR(16) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  KEY idx_hqla_task_updated (updated_at),
  UNIQUE KEY uk_hqla_task_rwa_sub (rwa_task_sub_id),
  KEY idx_hqla_task_rwa_task (rwa_task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_task_input (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  line_no INT NOT NULL DEFAULT 0,
  item_raw VARCHAR(64) NOT NULL DEFAULT '',
  item VARCHAR(8) NOT NULL DEFAULT '',
  sec_id VARCHAR(128) NOT NULL DEFAULT '',
  sec_key VARCHAR(128) NOT NULL DEFAULT '',
  ccy_group_raw VARCHAR(32) NOT NULL DEFAULT '',
  amount DECIMAL(24, 2) NULL,
  KEY idx_hqla_input_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_task_list (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  list_code VARCHAR(32) NOT NULL,
  sec_id VARCHAR(128) NOT NULL DEFAULT '',
  isin VARCHAR(32) NOT NULL DEFAULT '',
  issuer VARCHAR(200) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL DEFAULT '',
  amount DECIMAL(24, 2) NULL,
  ltv DECIMAL(10, 2) NULL,
  decline DECIMAL(10, 2) NULL,
  approved VARCHAR(8) NOT NULL DEFAULT '',
  note VARCHAR(255) NOT NULL DEFAULT '',
  KEY idx_hqla_list_task (task_id, list_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_task_reported (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  level VARCHAR(16) NOT NULL DEFAULT '',
  clause VARCHAR(16) NOT NULL DEFAULT '',
  principal_thousand DECIMAL(24, 2) NOT NULL DEFAULT 0,
  weighted_thousand DECIMAL(24, 2) NOT NULL DEFAULT 0,
  by_ccy JSON NULL,
  KEY idx_hqla_reported_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 外部债券参考库（跨任务共享）
CREATE TABLE hqla_reference (
  id VARCHAR(128) NOT NULL PRIMARY KEY,
  isin VARCHAR(32) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL DEFAULT '',
  issuer VARCHAR(200) NOT NULL DEFAULT '',
  ind VARCHAR(8) NOT NULL DEFAULT '',
  itype TINYINT NULL,
  ccy VARCHAR(8) NOT NULL DEFAULT '',
  mat VARCHAR(16) NULL,
  cp DECIMAL(12, 6) NULL,
  listed VARCHAR(8) NOT NULL DEFAULT '',
  acct VARCHAR(64) NOT NULL DEFAULT '',
  rating VARCHAR(32) NOT NULL DEFAULT '',
  book DECIMAL(24, 2) NULL,
  mv DECIMAL(24, 2) NULL,
  acc DECIMAL(24, 2) NULL,
  ecl DECIMAL(24, 2) NULL,
  rw DECIMAL(10, 2) NULL,
  p30 DECIMAL(10, 2) NULL,
  kind VARCHAR(16) NOT NULL DEFAULT '',
  sub VARCHAR(8) NOT NULL DEFAULT '',
  region VARCHAR(16) NOT NULL DEFAULT '',
  KEY idx_hqla_ref_isin (isin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 流动性产品配置：按监管规则版本维护 LCR 产品、标准字段、规则和参数。
CREATE TABLE liquidity_config_meta (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  lcr_version VARCHAR(40) NOT NULL DEFAULT '',
  lcr_version_name VARCHAR(200) NOT NULL DEFAULT '',
  snapshot_json JSON NULL,
  source VARCHAR(255) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_meta (jurisdiction, rule_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_product (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT '',
  product_group VARCHAR(64) NOT NULL DEFAULT '',
  side VARCHAR(16) NOT NULL DEFAULT '',
  source_system VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'LIVE',
  description VARCHAR(500) NOT NULL DEFAULT '',
  domains_json JSON NULL,
  param_key VARCHAR(64) NOT NULL DEFAULT '',
  rule_count INT NOT NULL DEFAULT 0,
  group_mode VARCHAR(8) NOT NULL DEFAULT 'NONE',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_product (jurisdiction, rule_version, code),
  KEY idx_liquidity_product_side (jurisdiction, rule_version, side)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_product_group (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  group_code VARCHAR(64) NOT NULL,
  group_name VARCHAR(128) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  conditions_json JSON NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  sort_order INT NOT NULL DEFAULT 0,
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_product_group (jurisdiction, rule_version, product_code, group_code),
  KEY idx_liquidity_product_group_product (jurisdiction, rule_version, product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_field_group (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  group_code VARCHAR(64) NOT NULL,
  group_name VARCHAR(128) NOT NULL,
  parent_code VARCHAR(64) NOT NULL DEFAULT '',
  description VARCHAR(500) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_field_group (jurisdiction, rule_version, product_code, group_code),
  KEY idx_liquidity_field_group_product (jurisdiction, rule_version, product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_dictionary (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  dict_code VARCHAR(64) NOT NULL,
  dict_name VARCHAR(128) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  dict_type VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
  product_code VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_dictionary (jurisdiction, rule_version, dict_code),
  KEY idx_liquidity_dictionary_product (jurisdiction, rule_version, product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_dictionary_item (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  dict_code VARCHAR(64) NOT NULL,
  item_code VARCHAR(64) NOT NULL,
  item_name VARCHAR(128) NOT NULL DEFAULT '',
  description VARCHAR(255) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  UNIQUE KEY uk_liquidity_dictionary_item (jurisdiction, rule_version, dict_code, item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_rule_scope (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  group_code VARCHAR(64) NOT NULL DEFAULT '',
  package_id VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_rule_scope (jurisdiction, rule_version, product_code, group_code, package_id),
  KEY idx_liquidity_rule_scope_product (jurisdiction, rule_version, product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_product_field (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  field_code VARCHAR(64) NOT NULL,
  field_name VARCHAR(128) NOT NULL DEFAULT '',
  category VARCHAR(64) NOT NULL DEFAULT '',
  field_group VARCHAR(64) NOT NULL DEFAULT '',
  group_order INT NOT NULL DEFAULT 0,
  data_type VARCHAR(24) NOT NULL DEFAULT 'STRING',
  role VARCHAR(24) NOT NULL DEFAULT 'NONE',
  required TINYINT NOT NULL DEFAULT 0,
  value_type VARCHAR(24) NOT NULL DEFAULT 'FREE_TEXT',
  dictionary VARCHAR(64) NOT NULL DEFAULT '',
  source_column VARCHAR(128) NOT NULL DEFAULT '',
  aliases_json JSON NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  sort_order INT NOT NULL DEFAULT 0,
  attributes_json JSON NULL,
  UNIQUE KEY uk_liquidity_field (jurisdiction, rule_version, product_code, field_code),
  KEY idx_liquidity_field_product (jurisdiction, rule_version, product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_rule (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  name VARCHAR(200) NOT NULL DEFAULT '',
  package_id VARCHAR(64) NOT NULL DEFAULT '',
  package_name VARCHAR(128) NOT NULL DEFAULT '',
  side VARCHAR(16) NOT NULL DEFAULT '',
  sequence_no INT NOT NULL DEFAULT 0,
  priority INT NOT NULL DEFAULT 0,
  rule_type VARCHAR(24) NOT NULL DEFAULT '',
  rule_type_name VARCHAR(64) NOT NULL DEFAULT '',
  condition_text TEXT NULL,
  result_text TEXT NULL,
  basis VARCHAR(128) NOT NULL DEFAULT '',
  description TEXT NULL,
  products_json JSON NULL,
  UNIQUE KEY uk_liquidity_rule (jurisdiction, rule_version, rule_id),
  KEY idx_liquidity_rule_side (jurisdiction, rule_version, side)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_param_table (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  table_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT '',
  rows_json JSON NOT NULL,
  note TEXT NOT NULL,
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_table (jurisdiction, rule_version, table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_param (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  param_id VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  value DECIMAL(18, 6) NOT NULL DEFAULT 0,
  unit VARCHAR(24) NOT NULL DEFAULT '',
  basis VARCHAR(128) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_param (jurisdiction, rule_version, param_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE liquidity_list (
  id VARCHAR(180) NOT NULL PRIMARY KEY,
  jurisdiction CHAR(2) NOT NULL,
  rule_version VARCHAR(40) NOT NULL,
  list_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  list_type VARCHAR(32) NOT NULL DEFAULT '',
  list_version VARCHAR(32) NOT NULL DEFAULT '',
  items_json JSON NOT NULL,
  note TEXT NOT NULL,
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_liquidity_list (jurisdiction, rule_version, list_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LCR 计量任务的数据集：一张 Sheet 一条，rows_json 保存标准化后的行对象。
CREATE TABLE hqla_task_dataset (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  dataset_id VARCHAR(64) NOT NULL,
  file_id VARCHAR(40) NOT NULL DEFAULT '',
  sheet_name VARCHAR(128) NOT NULL DEFAULT '',
  product_code VARCHAR(64) NOT NULL DEFAULT '',
  product_name VARCHAR(128) NOT NULL DEFAULT '',
  product_group_code VARCHAR(64) NOT NULL DEFAULT '',
  confidence DECIMAL(5, 2) NULL,
  confirm_level VARCHAR(16) NOT NULL DEFAULT '',
  confirmed_at VARCHAR(32) NOT NULL DEFAULT '',
  headers_json JSON NULL,
  rows_json LONGTEXT NULL,
  sample_json JSON NULL,
  profile_json JSON NULL,
  mapping_json JSON NULL,
  mapping_meta_json JSON NULL,
  quality_json JSON NULL,
  row_count INT NOT NULL DEFAULT 0,
  column_count INT NOT NULL DEFAULT 0,
  parse_status VARCHAR(16) NOT NULL DEFAULT 'parsed',
  input_version INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_hqla_dataset (task_id, dataset_id),
  KEY idx_hqla_dataset_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_snapshot (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_file (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  filename VARCHAR(255) NOT NULL DEFAULT '',
  file_hash CHAR(64) NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(64) NOT NULL DEFAULT '',
  uploaded_at VARCHAR(32) NOT NULL,
  KEY idx_hqla_file_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_record (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_product_rule (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_product_recognition (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_field_suggestion (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_field_mapping (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_quality_run (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  input_version INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  summary_json JSON NULL,
  started_at VARCHAR(32) NOT NULL,
  finished_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_hqla_quality_run_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_quality_issue (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_task_run (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_result_detail (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_result_summary (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(40) NOT NULL,
  task_id VARCHAR(32) NOT NULL,
  metric_key VARCHAR(64) NOT NULL,
  metric_name VARCHAR(128) NOT NULL DEFAULT '',
  value DECIMAL(24, 6) NULL,
  unit VARCHAR(24) NOT NULL DEFAULT '',
  detail_json JSON NULL,
  KEY idx_hqla_result_summary_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_calculation_exception (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_review (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  run_id VARCHAR(40) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewer VARCHAR(64) NOT NULL DEFAULT '',
  comment VARCHAR(1000) NOT NULL DEFAULT '',
  reviewed_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_hqla_review_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hqla_audit_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  object_type VARCHAR(32) NOT NULL DEFAULT '',
  object_id VARCHAR(64) NOT NULL DEFAULT '',
  detail_json JSON NULL,
  actor VARCHAR(64) NOT NULL DEFAULT '',
  at VARCHAR(32) NOT NULL,
  KEY idx_hqla_audit_log_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 平台账号与系统管理。登录只认启用中的账号和角色；密码存 SHA-256，不存明文。
CREATE TABLE app_role (
  id VARCHAR(16) NOT NULL PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  is_super TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(8) NOT NULL DEFAULT 'on',
  menus_json JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_user (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  role_id VARCHAR(16) NOT NULL,
  dept VARCHAR(64) NOT NULL DEFAULT '',
  email VARCHAR(128) NOT NULL DEFAULT '',
  phone VARCHAR(32) NOT NULL DEFAULT '',
  password_hash CHAR(64) NOT NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'on',
  orgs_json JSON NULL,
  last_login VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_app_user_username (username),
  KEY idx_app_user_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at VARCHAR(32) NOT NULL,
  username VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  device VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  KEY idx_login_log_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE operation_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at VARCHAR(32) NOT NULL,
  actor VARCHAR(64) NOT NULL DEFAULT '',
  action VARCHAR(64) NOT NULL,
  target VARCHAR(128) NOT NULL DEFAULT '',
  note VARCHAR(255) NOT NULL DEFAULT '',
  KEY idx_operation_log_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE llm_config (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  owner VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NOT NULL DEFAULT '',
  base_url VARCHAR(255) NOT NULL,
  model VARCHAR(64) NOT NULL,
  api_key VARCHAR(255) NOT NULL DEFAULT '',
  temperature DECIMAL(3, 1) NOT NULL DEFAULT 0.2,
  max_tokens INT NOT NULL DEFAULT 8192,
  timeout INT NOT NULL DEFAULT 60,
  status VARCHAR(8) NOT NULL DEFAULT 'on',
  is_default TINYINT NOT NULL DEFAULT 0,
  last_test VARCHAR(32) NOT NULL DEFAULT '',
  calls INT NOT NULL DEFAULT 0,
  KEY idx_llm_config_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE token_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at VARCHAR(32) NOT NULL,
  request_id VARCHAR(40) NOT NULL,
  model VARCHAR(64) NOT NULL,
  scene VARCHAR(64) NOT NULL DEFAULT '',
  user_name VARCHAR(64) NOT NULL DEFAULT '',
  org_name VARCHAR(64) NOT NULL DEFAULT '',
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  latency DECIMAL(8, 2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'success',
  KEY idx_token_log_at (at),
  KEY idx_token_log_user (user_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_group_run (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  thread_id VARCHAR(180) NOT NULL,
  run_id VARCHAR(80) NOT NULL,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  rule_version VARCHAR(40) NOT NULL DEFAULT '',
  product_family VARCHAR(48) NOT NULL DEFAULT '',
  group_id VARCHAR(80) NOT NULL DEFAULT '',
  action VARCHAR(32) NOT NULL DEFAULT 'auto',
  intent VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  proposal_id VARCHAR(80) NOT NULL DEFAULT '',
  draft_digest VARCHAR(100) NOT NULL DEFAULT '',
  error VARCHAR(1000) NOT NULL DEFAULT '',
  created_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  UNIQUE KEY uk_product_group_run (run_id),
  KEY idx_product_group_run_thread (thread_id),
  KEY idx_product_group_run_version (rule_version_id, product_family, group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_group_proposal (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  proposal_id VARCHAR(80) NOT NULL DEFAULT '',
  run_id VARCHAR(80) NOT NULL DEFAULT '',
  thread_id VARCHAR(180) NOT NULL DEFAULT '',
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  rule_version VARCHAR(40) NOT NULL DEFAULT '',
  product_family VARCHAR(48) NOT NULL DEFAULT '',
  group_id VARCHAR(80) NOT NULL DEFAULT '',
  version_no INT NOT NULL DEFAULT 1,
  proposal_json LONGTEXT,
  diff_json LONGTEXT,
  review_json LONGTEXT,
  conflicts_json LONGTEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  created_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_product_group_proposal_thread (thread_id),
  KEY idx_product_group_proposal_run (run_id),
  UNIQUE KEY uk_product_group_proposal (proposal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_group_constraint (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  rule_version_id VARCHAR(40) NOT NULL DEFAULT '',
  rule_version VARCHAR(40) NOT NULL DEFAULT '',
  product_family VARCHAR(48) NOT NULL DEFAULT '',
  group_id VARCHAR(80) NOT NULL DEFAULT '',
  constraint_type VARCHAR(64) NOT NULL DEFAULT '',
  constraint_json LONGTEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_by VARCHAR(80) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_product_group_constraint_scope (rule_version_id, product_family, group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_group_decision_audit (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  proposal_id VARCHAR(80) NOT NULL DEFAULT '',
  group_id VARCHAR(80) NOT NULL DEFAULT '',
  target_field VARCHAR(120) NOT NULL DEFAULT '',
  decision_type VARCHAR(32) NOT NULL DEFAULT '',
  action VARCHAR(32) NOT NULL DEFAULT '',
  before_json LONGTEXT,
  after_json LONGTEXT,
  actor VARCHAR(80) NOT NULL DEFAULT '',
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  KEY idx_product_group_audit_proposal (proposal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
