-- Installs a gate only. This migration never enables a job.
begin;
alter table tra_inventory_private.runtime
  add column manual_validated_batch uuid references public.tra_inventory_batches(id),
  add column manual_validated_at timestamptz,
  add column manual_validation_checks jsonb,
  add column schedule_enabled_at timestamptz;

create function public.tra_confirm_inventory_manual_import(p_batch uuid, p_expected_units jsonb, p_expected_issues jsonb, p_checks jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare actual_units jsonb; expected_units jsonb; actual_issues jsonb; expected_issues jsonb; batch public.tra_inventory_batches%rowtype;
begin
  perform pg_advisory_xact_lock(517384133);
  select * into batch from public.tra_inventory_batches where id=p_batch and active;
  if not found or batch.total_units<>517 or batch.market_units<>384 or batch.affordable_units<>133 then raise exception 'Expected active complete manual-import batch'; end if;
  if not exists(select 1 from tra_inventory_private.runtime where singleton and enabled and source_etag=batch.source_revision and last_success_at is not null and last_error is null) then
    raise exception 'Successful new Edge Function import is required';
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
revoke all on function public.tra_confirm_inventory_manual_import(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.tra_confirm_inventory_manual_import(uuid,jsonb,jsonb,jsonb) to service_role;

create function tra_inventory_private.enable_validated_schedule()
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare inventory_job bigint;
begin
  perform pg_advisory_xact_lock(517384133);
  if not exists(select 1 from tra_inventory_private.runtime r join public.tra_inventory_batches b on b.id=r.manual_validated_batch
      where r.singleton and r.enabled and b.active and r.manual_validated_at is not null and r.last_error is null
      and r.manual_validation_checks->'approved_reader_verified'='true'::jsonb
      and r.manual_validation_checks->'anonymous_denied'='true'::jsonb
      and r.manual_validation_checks->'unapproved_reader_denied'='true'::jsonb
      and r.manual_validation_checks->'dashboard_smoke_passed'='true'::jsonb) then
    raise exception 'Manual import and all validation checks must pass before schedule activation';
  end if;
  if (select count(*) from cron.job where jobname='tra-inventory-sync')<>1 then raise exception 'Expected one separate inventory job'; end if;
  select jobid into inventory_job from cron.job where jobname='tra-inventory-sync' and schedule='*/5 * * * *' and command like '%/functions/v1/tra-inventory-sync%';
  if inventory_job is null then raise exception 'Separate job target or schedule changed'; end if;
  perform cron.alter_job(inventory_job,active:=true);
  update tra_inventory_private.runtime set schedule_enabled_at=now() where singleton;
end;
$$;
revoke all on function tra_inventory_private.enable_validated_schedule() from public,anon,authenticated;
grant execute on function tra_inventory_private.enable_validated_schedule() to service_role;
commit;

-- Read-only dashboard gate. Does not enable a schedule or import data.
begin;
create function public.tra_inventory_ready()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.tra_inventory_access where user_id=auth.uid())
     and exists(select 1 from tra_inventory_private.runtime where singleton and enabled and manual_validated_at is not null
       and manual_validation_checks->'approved_reader_verified'='true'::jsonb
       and manual_validation_checks->'anonymous_denied'='true'::jsonb
       and manual_validation_checks->'unapproved_reader_denied'='true'::jsonb
       and manual_validation_checks->'dashboard_smoke_passed'='true'::jsonb)
     and exists(select 1 from public.tra_inventory_batches where active);
$$;
revoke all on function public.tra_inventory_ready() from public,anon;
grant execute on function public.tra_inventory_ready() to authenticated,service_role;
commit;
