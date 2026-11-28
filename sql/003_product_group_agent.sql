-- Product-group configuration Agent: run, proposal, user constraints and decision audit.

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
