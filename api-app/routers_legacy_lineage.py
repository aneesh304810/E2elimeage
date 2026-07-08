"""Legacy E2E Lineage router — backward lineage (SRC->STG1->STG2->DWH) plus
per-stage proof/variance, grouped by table then field. Powers the
'Legacy E2E Lineage' tab in Interface 360."""
from __future__ import annotations
import json, logging
from fastapi import APIRouter
from .db import query

log = logging.getLogger("cp.api.legacy_lineage")
router = APIRouter(prefix="/legacy-lineage", tags=["legacy-lineage"])


def _safe(sql, params=None):
    try:
        return query(sql, params or {})
    except Exception as e:  # noqa: BLE001
        log.warning("legacy_lineage query failed: %s", e)
        return []


def _variance(proof_rows):
    """Given a field's proof rows (one per stage), decide a variance verdict by
    comparing values across stages. Returns (status, detail)."""
    by_stage = {p["stage"]: (p.get("field_value") or "") for p in proof_rows}
    order = [s for s in ("SRC", "STG1", "STG2", "DWH") if s in by_stage]
    vals = [by_stage[s] for s in order if by_stage[s] != ""]
    if not vals:
        return ("no_data", "no sample values")
    uniq = set(v.strip() for v in vals)
    if len(uniq) == 1:
        return ("clean", "value consistent across stages")
    # case-only difference?
    if len(set(v.strip().lower() for v in vals)) == 1:
        return ("changed", "case differs across stages")
    return ("changed", "value differs across stages")


@router.get("/tables")
def tables():
    """Distinct DWH target tables with summary counts."""
    rows = _safe("""
        SELECT dwh_target_table AS table_name,
               COUNT(*) AS field_count,
               SUM(CASE WHEN LOWER(lineage_status) = 'mapped' THEN 1 ELSE 0 END) AS mapped,
               SUM(CASE WHEN LOWER(lineage_status) LIKE 'not applicable%' THEN 1 ELSE 0 END) AS not_applicable,
               SUM(CASE WHEN is_ud = 'Y' THEN 1 ELSE 0 END) AS ud_count
        FROM legacy_lineage
        WHERE dwh_target_table IS NOT NULL
        GROUP BY dwh_target_table
        ORDER BY dwh_target_table""")
    return {"tables": rows}


@router.get("/fields")
def fields(table: str):
    """All fields for a table, each with its lineage chain + a variance verdict.
    UD attributes are included (is_ud='Y') alongside the original CLOB field."""
    lin = _safe("""
        SELECT lineage_id, dwh_target_table, dwh_target_column, dwh_type, dwh_length, dwh_precision,
               stg2_source_table, stg2_source_column, stg2_to_dwh_transform, stg2_type, stg2_length, stg2_precision,
               stg1_source_table, stg1_source_column, stg1_type, stg1_length, stg1_precision,
               src_source_table, src_source_column, src_to_stg1_transform, stg1_to_stg2_transform,
               lineage_status, lineage_status_detail, is_ud, ud_key
        FROM legacy_lineage
        WHERE dwh_target_table = :t
        ORDER BY is_ud, dwh_target_column""", {"t": table})

    # pull all proof rows for this table once, group by field
    proof = _safe("""
        SELECT field_name, stage, field_value, is_ud, ud_key
        FROM legacy_proof
        WHERE proof_table = :t
        ORDER BY field_name, stage""", {"t": table})
    by_field = {}
    for p in proof:
        by_field.setdefault(p["field_name"], []).append(p)

    out = []
    for f in lin:
        col = f["dwh_target_column"]
        pr = by_field.get(col, [])
        status, detail = _variance(pr)
        f["variance_status"] = status
        f["variance_detail"] = detail
        f["proof"] = pr
        out.append(f)
    return {"table": table, "fields": out}


@router.get("/proof")
def proof(table: str, field: str):
    """Per-stage proof/variance for one field (used when a field is expanded)."""
    rows = _safe("""
        SELECT stage, field_value, is_ud, ud_key
        FROM legacy_proof
        WHERE proof_table = :t AND field_name = :f
        ORDER BY CASE stage WHEN 'SRC' THEN 0 WHEN 'STG1' THEN 1
                            WHEN 'STG2' THEN 2 WHEN 'DWH' THEN 3 ELSE 4 END""",
        {"t": table, "f": field})
    status, detail = _variance(rows)
    return {"table": table, "field": field, "stages": rows,
            "variance_status": status, "variance_detail": detail}
