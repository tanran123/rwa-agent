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
DROP TABLE IF EXISTS measure_line;
DROP TABLE IF EXISTS measure_batch;
DROP TABLE IF EXISTS product_exposure_rule;
DROP TABLE IF EXISTS crm_rule;
DROP TABLE IF EXISTS ccf_rule;
DROP TABLE IF EXISTS ead_product_rule;
DROP TABLE IF EXISTS ead_product_config;
DROP TABLE IF EXISTS ead_rule;
DROP TABLE IF EXISTS mo_weight_row;
DROP TABLE IF EXISTS bank_grade_row;
DROP TABLE IF EXISTS weight_rule;
DROP TABLE IF EXISTS rule_param;
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
  body JSON NOT NULL,
  UNIQUE KEY uq_exposure_document_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rule_param (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  grp VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  value VARCHAR(32) NOT NULL,
  unit VARCHAR(16) NOT NULL,
  used_for VARCHAR(255) NOT NULL
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
  ids_json JSON NOT NULL,
  param_id VARCHAR(32) NULL
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
  KEY idx_batch_date (base_date)
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
