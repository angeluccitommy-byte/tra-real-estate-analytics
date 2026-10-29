# Initial launch inside the existing TRA website

The website changes are on feature/tra-master-inventory. They wire the existing
navigation's Master Inventory button to the authenticated inventory module inside
**index.html**. No standalone report, new site or replacement dashboard is created.
Daily/Weekly/Monthly sections and all existing auth/report scripts are unchanged.
The existing Supabase client/session is reused; no service key enters the browser.

Initial data comes from the externally verified 517-unit, 33-field export:
384 Market and 133 Affordable. The exported rows are not committed or bundled
with public website assets. The browser reads only the approved RLS tables.

## Production database setup — through the authorized connected integration

The user has assigned production database setup to their connected Supabase
integration. This Codex runtime cannot use that connection, and its outbound
Supabase/production requests receive proxy 403. No credentials are needed in chat.

1. Inspect the actual project bluavamwhplpyuzeppfc for conflicts before any DDL:

```sql
select to_regclass('public.tra_inventory_units'),
       to_regclass('public.tra_inventory_batches'),
       to_regclass('public.tra_inventory_access'),
       to_regclass('tra_inventory_private.runtime');
select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='tra_inventory_units'
order by ordinal_position;
```

Compare existing inventory objects/functions against this branch. If objects
already exist, apply only the missing reviewed changes; do not rerun a CREATE
blindly, drop existing data or change unrelated schema. Use field-mapping.json to
confirm the inventory's 33 fields, including outdoor_space and direction.

2. For a new inventory schema, review/apply **001_inventory.sql**, then
**003_manual_validation_gate.sql**, then **004_snapshot_launch.sql**. Do **not**
apply 002 for this initial launch. Do not deploy any Edge Function or provision
Microsoft OAuth/SheetJS/Vault bindings for a snapshot-only launch. The reviewed
004 wrapper publishes the verified snapshot atomically while explicitly keeping
the new automatic workbook runtime disabled. It creates no scheduled job and
never modifies the production function or job 1.

3. Populate public.tra_inventory_access only for approved existing TRA auth UUIDs.
Do not grant access to all signed-in users. Preserve the existing approval model
for reports; do not change their policies or any existing production bindings.

4. Normalize the verified export using field-mapping.json and the accepted
external validation report. All dates are ISO date-only, numeric Actual Occupancy
stays numeric, and the accepted invalid source date remains null with its explicit
flag. Do not include resident names, internal notes or agent names. This command
prepares the exact RPC payload privately, with no network/database writes:

```sh
python3 inventory-integration/prepare_snapshot_launch.py "$TRA_INVENTORY_LATEST_CSV" "$TRA_INVENTORY_LATEST_REPORT" --output /tmp/tra-inventory-private-launch
```

Keep the output outside Git and public hosting. Through the authorized backend,
call **tra_publish_inventory_snapshot** with:
- p_units: all 517 normalized objects, each exactly the 33 mapped fields;
- p_issues: the accepted source-date flags;
- p_source_sha256: the independently calculated verified CSV SHA-256.

The RPC is service/backend-only and checks complete counts/keys through the
existing atomic publication RPC. Source revision is labeled snapshot:<sha256>.
The browser displays a verified-workbook-snapshot label and that automatic
refresh is off; it does not claim the snapshot is a live OneDrive feed.

5. Verify the seeded records against the same accepted export: all 517 unit keys,
every field value, Market/Affordable counts, text fields, dates, and accepted
flags. Check approved, unapproved authenticated and anonymous reads against the
actual project's RLS. Then run the manual checker from an authorized environment:

```sh
python3 inventory-integration/validate_manual_import.py "$TRA_INVENTORY_LATEST_CSV" "$TRA_INVENTORY_LATEST_REPORT" --output /tmp/tra-inventory-manual-validation.json
```

Alternatively, the connected integration can perform equivalent actual checks
and call **tra_confirm_inventory_manual_import** with the verified batch UUID,
expected units/flags, and p_checks containing approved_reader_verified,
anonymous_denied, unapproved_reader_denied, dashboard_smoke_passed and
source_sha256. Set checks true only after they actually pass. This records the
release gate; it does not enable a schedule. 004 allows the snapshot release gate
to pass with automatic refresh disabled, without pretending an OAuth import ran.

The existing website will then load records when tra_inventory_ready() returns
true for an approved account. Other accounts receive an unavailable state and
cannot read the RLS tables. Retry is available without changing other reports.

## Website hosting handoff

CNAME targets **https://traanalytics.com/**; repository history identifies GitHub
Pages hosting. This runtime could not read the production page or GitHub Pages
settings because both requests are blocked. The production source branch/build
setting must be confirmed through the existing GitHub Pages configuration.

- Review this feature branch's website commit and complete the database steps.
- Publish the tested commit using the repository's **existing** Pages source or
  workflow. If that source is main, use the existing review/merge process; no main
  merge or Pages setting change has been performed by this task.
- Do not introduce another website, hosting service or standalone HTML output.
- Sign in as an approved TRA account at the production URL, click Master Inventory,
  and repeat the filter/KPI/details/mobile checks. Confirm unapproved access fails.
- Verify the production URL and deployed commit before calling the feature live.

Keep tra-onedrive-sync v5, production cron job 1 and its five-minute schedule
unchanged. The new snapshot wrapper leaves the separate runtime disabled; do not
call enable_validated_schedule for this launch. Automatic inventory refresh can
be added later after its separate OAuth connection is ready.

## Tests using the real verified export (not synthetic inventory records)

Prepare the private payload as above, then run the existing-site test:

```sh
TRA_VERIFIED_SNAPSHOT_PAYLOAD=/tmp/tra-inventory-private-launch/snapshot-rpc-payload.json \
TRA_WEBSITE_VALIDATION_OUTPUT=/tmp/tra-inventory-private-launch/website-validation.json \
node inventory-integration/tests/website-verified.cjs
```

Requires Playwright/Chromium and @electric-sql/pglite@0.3.14 resolvable through
NODE_PATH. The test serves the actual existing index.html, seeds the **real**
verified rows into isolated PostgreSQL, compares every one of the 517 × 33 values,
executes approved/unapproved/anonymous local RLS checks, and tests navigation,
Market/Affordable/All, building/layout/status filters, search, sorting, KPIs,
mobile details, the release gate and snapshot-only operation. Inventory rows have
no synthetic fallback. Only isolated test account identities/transport boundaries
are substituted. This is not a claim of real Supabase/production URL verification.

The pre-existing legacy weeklyTabs appendChild page error is identified separately
by its original source line; no report script is modified to hide or fix it.
