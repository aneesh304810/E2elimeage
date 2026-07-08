"""CP Catalog ingestion orchestrator.

Runs the Excel-driven vertical slice steps. Each step is guarded (one failure
doesn't abort the rest), logged with duration, and idempotent. PII match runs LAST.
"""
from __future__ import annotations
import logging
import os
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cp.run")

# vertical-slice step order (Excel modules + PII; harvest steps are no-ops here)
STEPS = [
    "projects",
    "oracle",          # harvest Oracle schemas (real transformation tables)
    "feed_dictionary",
    "feed_catalog",
    "loader_catalog",
    "loader_workbook",
    "dbt",             # dbt models + table lineage + compiled SQL + column lineage
    "glossary",        # business/semantic terms from dbt metrics/meta + authored
    "airflow",         # DAGs + runs + orchestration (DAG->model) edges
    "interface360",
    "api360",
    "pii_classification",
    "pii_match",
    "datapoint_index",   # reads all loaded data
    "business_flow",     # after datapoint_index (resolves Flow_Datapoint_Map vs dp_registry)
    "reference_data",    # after datapoint_index (enriches data points by category+field)
    "guardrails",        # synthetic quality guardrail events (failed jobs + bad data)
    "legacy_lineage",    # legacy DWH end-to-end lineage (SRC->STG1->STG2->DWH) + proof
    "search_index",      # MUST be last - indexes everything for full-text search
]


def _connect():
    import oracledb
    dsn = os.environ["CP_CATALOG_DB_DSN"]
    # accept oracle://user:pass@host:port/service
    if dsn.startswith("oracle://"):
        rest = dsn[len("oracle://"):]
        creds, hostpart = rest.split("@", 1)
        user, pwd = creds.split(":", 1)
        return oracledb.connect(user=user, password=pwd, dsn=hostpart)
    return oracledb.connect(dsn=dsn)


def run(steps=None) -> None:
    steps = steps or STEPS
    conn = _connect()
    from .loader import Loader
    from .project_resolver import ProjectResolver
    loader = Loader(conn)
    resolver = ProjectResolver.from_env()

    for step in steps:
        t0 = time.time()
        try:
            _run_step(step, conn, loader, resolver)
            log.info("[%s] OK in %.2fs", step, time.time() - t0)
        except Exception as e:  # guarded: continue with remaining steps
            log.exception("[%s] FAILED: %s", step, e)
    conn.close()
    log.info("ingestion complete")


def _require_env(*names) -> bool:
    """Return True if all named env vars are set; else log a skip and return False."""
    import os
    missing = [n for n in names if not os.getenv(n)]
    if missing:
        log.info("  skipping (not configured): missing %s", ", ".join(missing))
        return False
    return True


def _run_step(step, conn, loader, resolver) -> None:
    if step == "projects":
        # registry seeded by sql/12_projects.sql; nothing to do at runtime
        return
    if step == "feed_dictionary":
        if not _require_env("DATA360_FEED_DICTIONARY_PATH"):
            return
        from .feed_dictionary_conn import FeedDictionaryConnector
        from .feed_dictionary_loader import FeedDictionaryLoader
        c = FeedDictionaryConnector.from_env()
        FeedDictionaryLoader(loader).load(c.parse())
        return
    if step == "interface360":
        if not _require_env("INTERFACE360_XLSX_PATH"):
            return
        from .interface360_conn import Interface360Connector
        from .interface360_loader import Interface360Loader
        c = Interface360Connector.from_env()
        Interface360Loader(loader, resolver).load(c.parse())
        return
    if step == "api360":
        if not _require_env("CP_CATALOG_ROOT"):
            return
        from .api360_conn import Api360Connector
        c = Api360Connector.from_env()
        c.load(loader, c.parse())
        return
    if step == "pii_classification":
        if not _require_env("PII_ATTRIBUTES_PATH"):
            return
        from .pii_classification_conn import PiiClassificationConnector
        from .pii_classification_loader import PiiClassificationLoader
        c = PiiClassificationConnector.from_env()
        PiiClassificationLoader(loader).load(c.parse())
        return
    if step == "oracle":
        if not _require_env("ORACLE_PROD_DSN", "ORACLE_PROD_SCHEMAS"):
            return
        from .oracle_conn import OracleConnector
        c = OracleConnector.from_env()
        c.load(loader, c.parse())
        return
    if step == "dbt":
        if not _require_env("DBT_MANIFEST_PATH"):
            return
        from .dbt_conn import DbtConnector
        from .lineage_sqlglot import load_column_lineage
        c = DbtConnector.from_env()
        bundle = c.parse()
        c.load(loader, bundle)
        # column-level lineage + transform expressions from compiled SQL
        load_column_lineage(loader, bundle["transforms"],
                            dialect=os.getenv("DBT_DIALECT", "oracle"))
        return
    if step == "glossary":
        if not _require_env("DBT_MANIFEST_PATH"):
            return
        from .glossary_conn import GlossaryConnector
        c = GlossaryConnector.from_env()
        c.load(loader, c.parse())
        return
    if step == "feed_catalog":
        from .feed_catalog_conn import FeedCatalogConnector
        for direction in ("inbound", "outbound"):
            c = FeedCatalogConnector.from_env(direction, resolver)
            if c:
                c.load(loader, c.parse())
        return
    if step == "loader_workbook":
        from .loader_workbook_conn import LoaderWorkbookConnector
        c = LoaderWorkbookConnector.from_env(resolver)
        if c:
            c.load(loader, c.parse())
        return
    if step == "loader_catalog":
        from .loader_catalog_conn import LoaderCatalogConnector
        c = LoaderCatalogConnector.from_env(resolver)
        if c:
            c.load(loader, c.parse())
        return
    if step == "airflow":
        if not _require_env("AIRFLOW_DSN"):
            return
        from .airflow_conn import AirflowConnector
        c = AirflowConnector.from_env()
        c.load(loader, c.parse())
        return
    if step == "reference_data":
        from .reference_data_conn import ReferenceDataConnector
        ReferenceDataConnector().load(loader)
        return
    if step == "business_flow":
        from .business_flow_conn import BusinessFlowConnector
        BusinessFlowConnector().load(loader)
        return
    if step == "search_index":
        from .search_index_builder import SearchIndexBuilder
        SearchIndexBuilder().load(loader)
        return
    if step == "guardrails":
        from .guardrails_synth import GuardrailsSynth
        n = GuardrailsSynth().load(loader)
        log.info("guardrails: merged %s events", n)
        return
    if step == "legacy_lineage":
        from .legacy_lineage_conn import LegacyLineageConnector
        c = LegacyLineageConnector.from_env()
        c.load(loader, c.parse())
        return
    if step == "datapoint_index":
        from .datapoint_indexer import DatapointIndexer
        idx = DatapointIndexer(conn)
        idx.load(loader, idx.run())
        return
    if step == "pii_match":
        from .pii_matcher import PiiMatcher
        PiiMatcher(loader, conn).run()
        return
    log.warning("unknown step: %s", step)


if __name__ == "__main__":
    run()
