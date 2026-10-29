# Later automated-workbook deployment runbook — separate Master Inventory

**Initial website launch:** use SNAPSHOT_LAUNCH.md instead. That path loads the
verified snapshot and deliberately skips the new Edge Function, Microsoft OAuth,
SheetJS and schedule 002. The website is now wired; the older automation-specific
steps below are not prerequisites for the initial launch.

Target project: `bluavamwhplpyuzeppfc`. Function/job: **tra-inventory-sync**.
Protected production function/job: **tra-onedrive-sync v5**, cron job **1**, active
`*/5 * * * *`. Do not redeploy that function, alter that job, change its token,
replace its configuration, or use a whole-project deployment command.

## Current readiness

Code and local validation are prepared. Deployment remains blocked:
- Supabase health/API host: proxy CONNECT **403** on the latest probe.
- Official SheetJS release host: proxy CONNECT **403**; vendor file is missing.
- Current cloud environment reports no Supabase secret/runtime bindings; no
  authorized management/database connection is available to this task.
- Real XLSM bytes were not uploaded. Latest CSV and its validation report are
  accepted, including one nonblocking externally approved date flag. Real SheetJS/XLSM decoding must
  still be compared before deployment.

Required permissions below are confirmed from the reviewed implementation and v5
reference. They have not been verified as granted on the remote project.

## Required permissions and secure bindings

| Actor / context | Required capability | Secure binding / location |
| --- | --- | --- |
| Deployment operator | Deploy only the new Edge Function and configure only its gateway setting | Authorized Supabase management connection or `SUPABASE_ACCESS_TOKEN` through secure environment settings |
| Migration operator | Create new public tables/functions, the private inventory schema, policies/grants, and FK reference to auth.users | Authorized SQL/DB connection via secure environment settings; raw DB credentials require a proper DB/TCP route, not an HTTPS placeholder |
| Migration operator | Use existing pg_cron, pg_net and Vault; create only the separate disabled job | Same authorized SQL connection; no extension replacement or changes to job 1 |
| New Edge runtime | Read tenant/client/drive/item identifiers from tra_sync.connection; read and rotate only its new Vault token; access only new inventory state/data and publication RPC | Existing `SUPABASE_DB_URL` runtime binding used by the reference pattern, if already supplied; reuse securely without exporting/replacing its value |
| New invocation guard and cron | Read the new hook inside the server and send it only to the new function | New Vault secret **tra_inventory_invocation**; no duplicate Edge env hook variable needed |
| New Microsoft authorization | Independent delegated workbook read grant, `Files.Read offline_access`, for configured tenant/client | New Vault secret **tra_inventory_refresh_token**; do not copy/reuse the rotating production tra_onedrive_refresh_token |
| Browser | Read the new inventory as an approved TRA account | Existing public browser key/session plus explicit auth UUID in tra_inventory_access; no service key in the browser |
| Manual validator | Call only the new confirmation RPC after source, access and UI checks | `TRA_INVENTORY_SERVICE_ROLE_KEY`, securely bound to the existing project service-role credential |
| Manual validator | Verify two distinct real signed-in identities, approved and unapproved | Short-lived `TRA_INVENTORY_APPROVED_READER_TOKEN` and `TRA_INVENTORY_UNAPPROVED_READER_TOKEN` through secure environment settings; never in chat or source files |

The runtime code reads only `tra_inventory_invocation` and
`tra_inventory_refresh_token` from Vault. It rotates only the latter and updates
only tra_inventory_private.runtime. The PostgreSQL lock key is distinct from v5.
Its new connection pool uses at most two connections per instance; verify project
capacity without changing the existing production pool.

Use deployment_preflight.sql to inspect permissions/presence on the actual target.
It returns booleans only, never decrypted Vault values, tokens, or workbook IDs.
Run it with the intended database role; do not infer permission from an unrelated
GitHub login, public browser key, or missing CLI login alone.

## Networking

The cloud worker needs HTTPS access to:
- bluavamwhplpyuzeppfc.supabase.co (health, REST/auth/function endpoints)
- api.supabase.com if using the management API/CLI
- cdn.sheetjs.com (exact official dependency artifact)
- npm registry/package destinations if checking/bundling npm:postgres@3.4.7

The deployed Edge Function separately needs its DB route, Microsoft
login.microsoftonline.com, graph.microsoft.com, and the actual workbook download
host returned by Graph. Determine that hostname through authorized metadata
without printing the signed URL; allow the exact required tenant/download host.
A direct database/pooler connection from the cloud worker additionally needs the
verified DB hostname and TCP route/port (usually 5432 or 6543); do not invent a
pooler region or bypass the proxy. Keep TLS verification and platform trust.

## SheetJS dependency gate

The uploaded v5 reference ZIP omits `vendor/xlsx.mjs`. Required version is **0.20.3**:
`https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs`.

Obtain a trusted expected SHA-256 from the official or authorized existing vendor
artifact. No checksum is known or invented in this package. Then run:

```sh
python3 inventory-integration/fetch_sheetjs.py --expected-sha256 "$TRUSTED_SHEETJS_SHA256"
```

Or supply `--from-file /secure/path/to/verified/xlsx.mjs`. The helper checks the
expected digest before writing and records provenance.json. It writes only the
new function's vendor file. Do not disable verification, transform the artifact,
substitute the old npm xlsx package, or deploy the read-only reference ZIP.

After vendoring, run Deno check/bundle and a real XLSM comparison against the
accepted export, including Outdoor Space and Direction. Local mocked SheetJS
checks are not equivalent to that check. If original headers resolve ambiguously,
stop rather than guess columns or drop fields. Macros are never executed.

## Staging, then deployment with the job disabled

1. Use a properly authorized isolated Supabase development target to execute the
   schema, real RLS and function/OAuth tests first. Review target-specific project
   IDs in the URL guards and cron template before using a test target; do not
   accidentally test destructive operations on production. Provision the new
   secrets securely and populate only reviewed approved-reader UUIDs.
2. After staging passes and dependencies/credentials/networking are ready, run
   deployment_preflight.sql on the existing target and confirm protected job 1
   remains active on its original schedule. Do not display its invocation payload
   or decrypted Vault secrets.
3. Apply **001_inventory.sql**, then **002_disabled_schedule.sql**, then
   **003_manual_validation_gate.sql**, under the authorized migration role. These
   files create only new inventory objects. 002 creates and disables the new job
   atomically; 003 installs guards and does not invoke an activation function.
4. Deploy only the new function:

```sh
supabase functions deploy tra-inventory-sync --project-ref bluavamwhplpyuzeppfc --no-verify-jwt
```

   The new function's own constant-time Vault invocation hook authenticates every
   request. Merge only the new entry from function-config.example.toml if needed;
   never replace the existing project config or deploy all functions.
5. Make sure new Vault bindings exist and new approved-user access rows are
   provisioned. Do not change existing table policies or production bindings.
   Enable only the new **runtime**, to allow a manual test:

```sql
update tra_inventory_private.runtime set enabled=true where singleton;
```

   This does **not** enable its cron job. Confirm `tra-inventory-sync` remains
   inactive and `tra-onedrive-sync` remains active at `*/5 * * * *`.

## First manual import and all validation checks

Invoke the new function from the database, keeping the hook server-side:

```sql
select net.http_post(
  url := 'https://bluavamwhplpyuzeppfc.supabase.co/functions/v1/tra-inventory-sync',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-inventory-invocation',(select decrypted_secret from vault.decrypted_secrets where name='tra_inventory_invocation')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
);
```

Only the request ID is returned. Inspect the new function's sanitized status/new
runtime state; confirm source ETag stability, complete import and no new last_error.
Do not read/export Vault values. Do not call the old function or change job 1.

With the latest independently validated export/report from that same workbook
revision and the three secure validator bindings set, run:

```sh
python3 inventory-integration/validate_manual_import.py "$TRA_INVENTORY_LATEST_CSV" "$TRA_INVENTORY_LATEST_REPORT" --output /tmp/tra-inventory-manual-validation.json
```

The checker requires:
- 517 unique units with the exact accepted unit key set, 384 Market/133 Affordable.
- Every one of the 33 values matches, including Outdoor Space/Direction; numeric
  XLSM values use exact IEEE-754 equivalence, integer/date/text values are exact.
- Corrected dates and only the accepted external-report nonblocking null/date flag
  (or an updated accepted report matching a newly corrected source revision).
- Approved authenticated reader can retrieve all pinned pages; a distinct signed-in
  unapproved reader and anonymous requests cannot read either inventory table.
- Chromium smoke check of the actual retrieved data: Market/Affordable/All, KPI
  cards, search, details including the two new fields, sorting and pagination.

Only then does it call the service-only confirmation RPC, which also compares
all database values/source flags and verifies a successful Edge import state.
It records the validated batch and check booleans. It **never activates a job**.
A changed active batch, failed access test, missing field or failed UI check
prevents the activation gate from passing. Source/report revision differences must
be reconciled rather than forcing a pass or silently overwriting expectations.

## Dashboard and schedule activation — only after the checker passes

Until the checker passes, `tra_inventory_ready()` is false and bootstrap.mjs
leaves the current explicitly labeled snapshot alone. After successful manual
validation, the reviewed dashboard wiring can reuse the existing Supabase client:

- Add only `export {supabase as traSupabase};` to the existing reader module.
- Import that existing client and mountValidatedInventory from bootstrap.mjs in
  the existing page; call it for document.getElementById('inventory').
- Do not create new project credentials or alter existing report/sync behavior.

The view uses existing TRA classes/design and exposes Market, Affordable and All
program filters. Outdoor Space and Direction appear in the 33-field apartment
details. No dashboard wiring/activation has been applied in this package.

Only after the first manual import has passed **all** checks may an authorized
operator explicitly run:

```sql
select tra_inventory_private.enable_validated_schedule();
```

That guarded function enables only the separate inventory job. It fails before
validation, if the validated batch is no longer active, if the target/schedule
changed, or if a validation check/last import failed. Never bypass it with a direct
cron.alter_job call. No setup, validation script or migration calls it automatically.

Observe subsequent new-function runs and separately confirm job 1/function v5 are
unchanged. Rollback of the new integration means disabling **only** its new job
and new runtime and removing its dashboard mount. Preserve the last complete
inventory batch and all existing production objects; do not reset/delete them.
