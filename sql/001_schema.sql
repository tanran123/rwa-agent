-- 信用风险 RWA 产品库
-- 先执行本文件，再执行 002_seed.sql
-- mysql -u root -p < sql/001_schema.sql

CREATE DATABASE IF NOT EXISTS rwa
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE rwa;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS assistant_turn;
DROP TABLE IF EXISTS rwa_task_sub;
DROP TABLE IF EXISTS rwa_task;
DROP TABLE IF EXISTS measure_line;
DROP TABLE IF EXISTS measure_batch;
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
DROP TABLE IF EXISTS hqla_task;
DROP TABLE IF EXISTS hqla_reference;
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
  KEY idx_rule_version_jur (jurisdiction, status)
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
  KEY idx_clause_jur (jurisdiction)
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
  product_code VARCHAR(32) NOT NULL PRIMARY KEY,
  needed TINYINT NOT NULL DEFAULT 1,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  side ENUM('on', 'off') NULL,
  version VARCHAR(40) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 一个产品下的 EAD 规则，seq 自上而下，第一条命中生效。
CREATE TABLE ead_product_rule (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
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
  product_code VARCHAR(32) NOT NULL PRIMARY KEY,
  needed TINYINT NOT NULL DEFAULT 1,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  max_slots TINYINT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 逐笔列名绑定。attr 只有 crm_type / crm_value / crm_weight 三个值。
CREATE TABLE crm_slot_column (
  product_code VARCHAR(32) NOT NULL,
  attr VARCHAR(16) NOT NULL,
  slot TINYINT NOT NULL,
  column_name VARCHAR(80) NOT NULL,
  PRIMARY KEY (product_code, attr, slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 产品的合格缓释物字典。字典外的类型视为不合格，缓释不予认定。
CREATE TABLE crm_eligible_type (
  product_code VARCHAR(32) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  seq INT NOT NULL DEFAULT 1,
  PRIMARY KEY (product_code, code)
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
  KEY idx_rwa_task_updated (updated_at)
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
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  KEY idx_rwa_sub_task (task_id)
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
  KEY idx_batch_date (base_date),
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
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  KEY idx_hqla_task_updated (updated_at)
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
