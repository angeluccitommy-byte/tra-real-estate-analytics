-- Inventory-only snapshot launch. No Edge deployment, Vault or OAuth required.
-- Apply after reviewed inventory migrations 001 and 003; do not install job 002
-- for the initial snapshot launch. Existing production sync/job 1 are untouched.
begin;
create function public.tra_publish_inventory_snapshot(p_units jsonb,p_issues jsonb,p_source_sha256 text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare published uuid;
begin
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Verified source SHA-256 required'; end if;
  perform pg_advisory_xact_lock(517384133);
  if exists(select 1 from cron.job where jobname='tra-inventory-sync' and active) then
    raise exception 'Separate inventory refresh must be inactive before snapshot publication';
  end if;
  published := public.tra_publish_inventory(p_units,p_issues,'snapshot:'||p_source_sha256,517,384,133);
  update tra_inventory_private.runtime set
    enabled=false,
    source_etag='snapshot:'||p_source_sha256,
    source_modified_at=null,
    last_success_at=now(),last_checked_at=now(),last_error=null,
    manual_validated_at=case when manual_validated_batch=published then manual_validated_at else null end,
    manual_validation_checks=case when manual_validated_batch=published then manual_validation_checks else null end,
    manual_validated_batch=case when manual_validated_batch=published then manual_validated_batch else null end
  where singleton;
  return published;
end;
$$;
revoke all on function public.tra_publish_inventory_snapshot(jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.tra_publish_inventory_snapshot(jsonb,jsonb,text) to service_role;

create or replace function public.tra_confirm_inventory_manual_import(p_batch uuid, p_expected_units jsonb, p_expected_issues jsonb, p_checks jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare actual_units jsonb; expected_units jsonb; actual_issues jsonb; expected_issues jsonb; batch public.tra_inventory_batches%rowtype;
begin
  perform pg_advisory_xact_lock(517384133);
  select * into batch from public.tra_inventory_batches where id=p_batch and active;
  if not found or batch.total_units<>517 or batch.market_units<>384 or batch.affordable_units<>133 then raise exception 'Expected active complete manual-import batch'; end if;
  if not exists(select 1 from tra_inventory_private.runtime where singleton and (enabled or source_etag like 'snapshot:%') and source_etag=batch.source_revision and last_success_at is not null and last_error is null) then
    raise exception 'Successful inventory import is required';
  end if;
  if jsonb_typeof(p_checks) is distinct from 'object'
     or p_checks->'approved_reader_verified' is distinct from 'true'::jsonb
     or p_checks->'anonymous_denied' is distinct from 'true'::jsonb
     or p_checks->'unapproved_reader_denied' is distinct from 'true'::jsonb
     or p_checks->'dashboard_smoke_passed' is distinct from 'true'::jsonb
     or coalesce(p_checks->>'source_sha256','') !~ '^[a-f0-9]{64}$' then
    raise exception 'All external validation checks and source hash are required';
  end if;
  if jsonb_typeof(p_expected_units) is distinct from 'array' or jsonb_typeof(p_expected_issues) is distinct from 'array' then raise exception 'Expected validation arrays'; end if;
  select coalesce(jsonb_agg(to_jsonb(u)-'batch_id' order by building,unit_id),'[]') into actual_units from public.tra_inventory_units u where batch_id=p_batch;
  select coalesce(jsonb_agg(x order by x->>'building',x->>'unit_id'),'[]') into expected_units from jsonb_array_elements(p_expected_units) x;
  if actual_units is distinct from expected_units then raise exception 'Manual import differs from independently validated source'; end if;
  -- Bootstrap accepts zero issues or one explicitly accepted external-report date flag.
  if jsonb_array_length(batch.date_issues)>1 or exists(select 1 from jsonb_array_elements(batch.date_issues) i where
     coalesce(i->>'unit_id','')='' or coalesce(i->>'field','') not in ('early_occupancy_start','lease_start','early_cancellation_date','lease_expiration','application_date','signed_date')
     or coalesce(i->>'workbook_cell','') !~ '^(U|V|W|X|AF|AG)[1-9][0-9]*$') then
    raise exception 'Unreviewed date issues require validation before activation';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('unit_id',i->'unit_id','field',i->'field','workbook_cell',i->'workbook_cell','source_value',i->'source_value') order by i->>'unit_id',i->>'field'),'[]')
    into actual_issues from jsonb_array_elements(batch.date_issues) i;
  select coalesce(jsonb_agg(jsonb_build_object('unit_id',i->'unit_id','field',i->'field','workbook_cell',i->'workbook_cell','source_value',i->'source_value') order by i->>'unit_id',i->>'field'),'[]')
    into expected_issues from jsonb_array_elements(p_expected_issues) i;
  if actual_issues is distinct from expected_issues then raise exception 'Source date flags do not match the accepted validation'; end if;
  update tra_inventory_private.runtime set manual_validated_batch=p_batch,manual_validated_at=now(),manual_validation_checks=p_checks where singleton;
end;
$$;
create or replace function public.tra_inventory_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.tra_inventory_access where user_id=auth.uid())
     and exists(select 1 from tra_inventory_private.runtime where singleton and (enabled or source_etag like 'snapshot:%') and manual_validated_at is not null
       and manual_validation_checks->'approved_reader_verified'='true'::jsonb
       and manual_validation_checks->'anonymous_denied'='true'::jsonb
       and manual_validation_checks->'unapproved_reader_denied'='true'::jsonb
       and manual_validation_checks->'dashboard_smoke_passed'='true'::jsonb)
     and exists(select 1 from public.tra_inventory_batches where active);
$$;
-- Existing service-only confirmation privileges and authenticated readiness
-- privileges remain in place on these replaced functions.
commit;
