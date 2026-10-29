# TRA Master Inventory deployment package

Website integration for Supabase project `bluavamwhplpyuzeppfc` is wired into the
existing index.html. Nothing has been deployed to production by this task. Production `tra-onedrive-sync` v5, cron job 1 (`*/5 * * * *`), existing
report tables and sync configuration remain unchanged. Only the inventory section
and its scoped assets are integrated into the current dashboard.

For the initial verified-snapshot website launch, use
[SNAPSHOT_LAUNCH.md](SNAPSHOT_LAUNCH.md). It does not need Microsoft OAuth,
SheetJS, a new Edge deployment or a scheduled job. [DEPLOYMENT.md](DEPLOYMENT.md)
describes the separate later automated-workbook rollout. [field-mapping.json](field-mapping.json) is the
final machine-readable source/field/type contract.

## Accepted inventory contract

The latest accepted export has **517 unique units: 384 Market and 133 Affordable**.
The complete 33-field model now retains **Outdoor Space (`outdoor_space`)** and
**Direction (`direction`)**. Source and Renewal from the earlier export are not in
this new schema. Tenant names, notes and agent names are excluded. Required keys
are building, unit ID, category and status; blanks in other fields remain null.
Numeric zero remains zero. Actual Occupancy is numeric, not a date. Excel 1900
calendar dates are converted without a timezone shift or fictitious leap day.

Accepted source-date corrections and the remaining nonblocking date flag are read
from the external validation report. Flagged units remain present with null date
fields. No actual unit identifiers, lease dates, rents, workbook exports or
validation payloads are included in this commit. All bundled regression fixtures
are generated fictional data. The 517/384/133 counts are non-secret acceptance
configuration, not a bundled workbook dataset.

## Deployment files

- `001_inventory.sql`: new inventory/batch/access tables, atomic service-only
  publication, separate disabled runtime state, batch pinning and idempotency.
  No modifications to existing tables, policies or the production Edge Function.
- `002_disabled_schedule.sql`: installs **only** `tra-inventory-sync`, every five
  minutes, disabled in the same transaction. Refuses an existing job of that name.
- `003_manual_validation_gate.sql`: records an independently verified manual
  import, rejects source/field/issue mismatches, and guards schedule activation.
  Its migrations do not call the activation function. Readiness is false before
  the gate passes. Direct administrative bypasses must not be used.
- `../supabase/functions/tra-inventory-sync/`: distinct inventory-only Edge Function
  using the v5 reference's Graph/refresh-token pattern, with separate token,
  advisory lock and state. It reads only identifiers from `tra_sync.connection`.
  It never reads/rotates `tra_onedrive_refresh_token` or writes existing sync state.
- `master-inventory.mjs`: tested complete-batch reader, Market/Affordable/All
  filters, search, combined building/status/layout filters, numeric/natural sorting,
  pagination, category KPIs, unit mix and all 33 fields in apartment details.
  Outdoor Space and Direction are preserved and displayed as source text.
- `bootstrap.mjs`: displays a safe unavailable state until the database readiness
  gate passes. This module is not wired into the current dashboard yet.
- `validate_latest_export.py`: strict latest-header adapter and local candidate
  validation, including the accepted external report's date flag.
- `validate_manual_import.py`: checks live records against the source, actual
  approved/unapproved/anonymous access, and browser behavior, then records the
  manual gate. **It never activates the new schedule.**
- `deployment_preflight.sql`: read-only permission/presence checks; outputs no
  Vault values or workbook identifiers.
- `fetch_sheetjs.py`: verifies the exact vendor artifact against a trusted expected
  SHA-256 before writing only the new function's dependency.

Local CSV/XLSM utilities remain in the folder for development. The optional
client-credentials Graph path in `sync_inventory.py` is not the deployed sync
mechanism and its credentials are not requirements for the Edge Function.

## Validation performed

- 13 Python tests: source counts/keys/dates, all numeric values, privacy, header
  validation, local XLSM conversion, Outdoor Space/Direction preservation, report
  disagreement rejection, and positive/negative mocked live validation checks.
- 4 dashboard model/reader/bootstrap tests: Market/Affordable/All KPIs, combined
  filters/search, numeric/natural sorting/nulls, pinned multipage reads, partial
  fetch rejection and leaving an unvalidated tab untouched.
- 3 workbook parser tests with synthetic cell fixtures made from the accepted
  latest export, plus execution of the actual Edge handler with mocked transport,
  database and SheetJS boundaries. Counts, the accepted date flag, token isolation and
  ETag races were checked. This does not replace real SheetJS/XLSM decoding.
- Chromium: category filters/KPIs, 33-field details including Outdoor Space and
  Direction, corrected dates, retained flagged null, search, sorting and pagination.
- Isolated PostgreSQL (PGlite): migrations/RPC/RLS, all 517 rows, exact new text
  fields, idempotency and rollback. A simulated cron/Vault extension boundary
  verifies the new job starts disabled, activation fails before manual checks,
  changed data fails validation, readiness changes only after successful checks,
  and job 1 remains unchanged. No actual pg_cron job was run.

Real Supabase and production hosting checks are handled through the user’s connected
integration; this runtime remains proxy-blocked. The new actual-site test uses the
real verified export and real isolated PostgreSQL RLS; see SNAPSHOT_LAUNCH.md.
OAuth/Graph/SheetJS are not requirements for the initial snapshot launch.
Previous complete batches are intentionally retained; agree a retention policy
before removing any historical data needed by pinned readers or audit evidence.

## Reproduce checks without private data

Use the existing isolated checkout; no worktree is needed. From repository root:

```sh
python3 -m pip install -r inventory-integration/requirements.txt
python3 inventory-integration/tests/build_fixtures.py
PYTHONPATH=inventory-integration python3 -m unittest discover -s inventory-integration/tests -p 'test_*.py' -v
node inventory-integration/tests/master-inventory.test.mjs
node inventory-integration/tests/workbook-edge.test.mjs
node inventory-integration/tests/browser.cjs
```

`tests/synthetic.py` generates a wholly fictional 517-unit dataset under /tmp;
no production exports or tenant information are needed or bundled. The original
legacy-format and accepted-format scenarios are both synthetic. Real source
files/reports are provided separately to the validator commands in DEPLOYMENT.md
and must remain outside Git.

The browser test requires Playwright and Chromium. Database tests use
`@electric-sql/pglite@0.3.14`; mocked Edge execution uses `esbuild@0.25.12`. Install
these under /tmp (not the application) and set NODE_PATH to their node_modules
when running `tests/database.cjs` / `tests/function.cjs`. No existing application
manifest, lockfile, production function, schedule or dashboard file was modified.
