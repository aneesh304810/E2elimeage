-- Legacy end-to-end lineage (SRC -> STG1 -> STG2 -> DWH) + proof/variance samples.
-- Feeds the "Legacy E2E Lineage" tab in Interface 360. Idempotent.

-- 1) LINEAGE MAP: one row per DWH target column, tracing back through stages.
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_tables WHERE table_name = 'LEGACY_LINEAGE';
  IF n = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE legacy_lineage (
        lineage_id            VARCHAR2(600) NOT NULL,  -- dwh_table:dwh_column[:ud_key]
        dwh_target_table      VARCHAR2(200),
        dwh_target_column     VARCHAR2(200),
        dwh_type              VARCHAR2(60),
        dwh_length            VARCHAR2(30),
        dwh_precision         VARCHAR2(30),
        stg2_source_table     VARCHAR2(200),
        stg2_source_column    VARCHAR2(200),
        stg2_to_dwh_transform CLOB,
        stg2_type             VARCHAR2(60),
        stg2_length           VARCHAR2(30),
        stg2_precision        VARCHAR2(30),
        stg1_source_table     VARCHAR2(200),
        stg1_source_column    VARCHAR2(200),
        stg1_type             VARCHAR2(60),
        stg1_length           VARCHAR2(30),
        stg1_precision        VARCHAR2(30),
        src_source_table      VARCHAR2(200),
        src_source_column     VARCHAR2(200),
        src_to_stg1_transform CLOB,
        stg1_to_stg2_transform CLOB,
        lineage_status        VARCHAR2(60),
        lineage_status_detail VARCHAR2(1000),
        is_ud                 CHAR(1) DEFAULT 'N',      -- Y when exploded from the UD CLOB
        ud_key                VARCHAR2(60),             -- e.g. UD_7
        CONSTRAINT pk_legacy_lineage PRIMARY KEY (lineage_id)
      )]';
  END IF;
END;
/

-- 2) PROOF: sample values per field per stage, so you can see where a value
--    changes/drops across DWH / STG2 / STG1. One row per (field, stage).
DECLARE
  n NUMBER;
BEGIN
  SELECT COUNT(*) INTO n FROM user_tables WHERE table_name = 'LEGACY_PROOF';
  IF n = 0 THEN
    EXECUTE IMMEDIATE q'[
      CREATE TABLE legacy_proof (
        proof_id     VARCHAR2(650) NOT NULL,  -- table:field:stage[:ud_key]
        proof_table  VARCHAR2(200),
        field_name   VARCHAR2(200),
        stage        VARCHAR2(20),            -- DWH | STG2 | STG1 | SRC
        field_value  CLOB,
        is_ud        CHAR(1) DEFAULT 'N',
        ud_key       VARCHAR2(60),
        CONSTRAINT pk_legacy_proof PRIMARY KEY (proof_id)
      )]';
  END IF;
END;
/

CREATE INDEX ix_legacy_lineage_dwh ON legacy_lineage (dwh_target_table, dwh_target_column);
CREATE INDEX ix_legacy_proof_field ON legacy_proof (proof_table, field_name, stage);
