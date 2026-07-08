# Legacy E2E Lineage — install

New tab in Interface 360 that back-tracks any DWH field to its legacy source
through SRC -> STG1 -> STG2 -> DWH, grouped by table -> field -> lineage, with
column-level DWH type/length/precision, a data-variance verdict per field, and
per-stage proof. UD_n attributes from the JSON CLOB are exploded into their own
fields; the original CLOB is kept too. Built on and tested against your uploaded
codebase.

## Files -> where they go

| In zip | Copy to | New/Overwrite |
|---|---|---|
| `sql/26_legacy_lineage.sql` | `sql/26_legacy_lineage.sql` | NEW |
| `ingestion/legacy_lineage_conn.py` | `ingestion/legacy_lineage_conn.py` | NEW |
| `ingestion/run.py` | `ingestion/run.py` | OVERWRITE (adds legacy_lineage step) |
| `api-app/routers_legacy_lineage.py` | `api/app/routers_legacy_lineage.py` | NEW |
| `api-app/main.py` | `api/app/main.py` | OVERWRITE (mounts the router) |
| `ui-src/LegacyLineage.jsx` | `ui/src/LegacyLineage.jsx` | NEW |
| `ui-src/Interface360.jsx` | `ui/src/Interface360.jsx` | OVERWRITE (adds the tab) |
| `ui-src/api.js` | `ui/src/api.js` | OVERWRITE (adds 3 API methods) |

NOTE: this main.py and api.js also contain the search-fix changes, so if you
apply this AFTER the search-fix patch, you're fine — they're the same versions.

## Step 1 — copy (from project root)

```powershell
$src = "C:\path\to\unzipped\legacy-lineage"
Copy-Item "$src\sql\26_legacy_lineage.sql"          sql\26_legacy_lineage.sql            -Force
Copy-Item "$src\ingestion\legacy_lineage_conn.py"   ingestion\legacy_lineage_conn.py    -Force
Copy-Item "$src\ingestion\run.py"                   ingestion\run.py                    -Force
Copy-Item "$src\api-app\routers_legacy_lineage.py"  api\app\routers_legacy_lineage.py   -Force
Copy-Item "$src\api-app\main.py"                    api\app\main.py                     -Force
Copy-Item "$src\ui-src\LegacyLineage.jsx"           ui\src\LegacyLineage.jsx            -Force
Copy-Item "$src\ui-src\Interface360.jsx"            ui\src\Interface360.jsx             -Force
Copy-Item "$src\ui-src\api.js"                       ui\src\api.js                       -Force
```

## Step 2 — create the tables

```powershell
sqlplus -S $env:CP_CATALOG_DB_DSN @sql\26_legacy_lineage.sql
```

## Step 3 — point the connector at your workbook + ingest

The connector reads two sheets:
- lineage/schema sheet — auto-detected by name containing "lineage" (your
  "legacy data lineage" sheet)
- proof sheet — auto-detected as "e2e" (your e2e sheet)

Set the path (and optionally override sheet names) then run just this step:

```powershell
$env:CP_LEGACY_LINEAGE_XLSX = "C:\SEI\bbhcatalog\data\legacy_lineage.xlsx"
# optional overrides if auto-detect misses:
# $env:CP_LEGACY_LINEAGE_SHEET = "legacy data lineage"
# $env:CP_LEGACY_PROOF_SHEET   = "e2e"

python -m ingestion.run legacy_lineage
```

## Step 4 — full restart

```powershell
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
Get-ChildItem -Path api -Filter __pycache__ -Recurse -Directory | Remove-Item -Recurse -Force
uvicorn app.main:app --app-dir api --port 8000
# separate terminal:
cd ui ; npm run dev
# browser: Ctrl+Shift+R
```

## Step 5 — verify

```powershell
curl "http://localhost:8000/legacy-lineage/tables"
```
Should list your DWH tables with counts. Then Interface 360 -> Legacy E2E Lineage
tab -> expand a table -> expand a field -> see the SRC->STG1->STG2->DWH chain and
the per-stage proof/variance.

## What was tested here
The connector + variance logic were run against a synthetic workbook matching
your exact structure (Table/Headers/DWH/STG2/STG1 layout, UD JSON in the CLOB):
- lineage rows parsed with correct statuses (Mapped / Not Applicable)
- proof exploded correctly: original CLOB kept + each UD_n as its own row per stage
- variance verdict works: CUSIP flagged "changed / case differs" (68609bud7 vs
  68609BUD7), SECURITY_KEY "clean"

## Honest caveats
- Tested against a synthetic file matching your described layout, NOT your real
  workbook (I don't have it). If your real sheet names or the proof row tags
  (DWH/STG2/STG1) differ, use the CP_LEGACY_*_SHEET env vars or tell me and I'll
  adjust the parser.
- The variance verdict compares sample values across stages. If you have an
  explicit variance/status column in your data, I can use that instead.
- SRC-stage proof: your sample proof sheet only had DWH/STG2/STG1 rows (no SRC).
  The UI handles SRC being absent (shows the chain without it). If your real file
  has SRC proof rows, they'll appear automatically.
