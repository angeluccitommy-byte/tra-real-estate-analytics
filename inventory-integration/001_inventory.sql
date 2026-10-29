-- PREPARED ONLY. Apply to a development target and validate before production.
-- Existing sync/functions/tables/policies are not altered.
begin;
create schema tra_inventory_private;
revoke all on schema tra_inventory_private from public, anon, authenticated;
grant usage on schema tra_inventory_private to service_role;
create table tra_inventory_private.runtime (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  source_etag text,
  source_modified_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text
);
insert into tra_inventory_private.runtime(singleton) values(true);
revoke all on tra_inventory_private.runtime from public, anon, authenticated;
grant all on tra_inventory_private.runtime to service_role;
create table public.tra_inventory_access (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.tra_inventory_access enable row level security;
create policy inventory_access_self on public.tra_inventory_access for select to authenticated using (user_id = auth.uid());
create table public.tra_inventory_batches (
  id uuid primary key default gen_random_uuid(),
  synced_at timestamptz not null default now(),
  source_revision text not null,
  total_units integer not null,
  market_units integer not null,
  affordable_units integer not null,
  date_issues jsonb not null default '[]',
  active boolean not null default false,
  check (total_units = market_units + affordable_units)
);
create unique index tra_inventory_one_active on public.tra_inventory_batches ((active)) where active;
create table public.tra_inventory_units (
  batch_id uuid not null references public.tra_inventory_batches(id),
  building text,
  unit_id text,
  floor integer,
  unit_type text,
  bedrooms integer,
  bathrooms numeric,
  square_feet integer,
  inventory_category text,
  lease_status text,
  gross_rent numeric,
  free_months numeric,
  lease_term_months numeric,
  net_effective_rent numeric,
  gross_rent_psf_year numeric,
  net_rent_psf_year numeric,
  early_occupancy_start date,
  lease_start date,
  early_cancellation_date date,
  lease_expiration date,
  actual_occupancy numeric,
  total_free_rent numeric,
  gross_monthly numeric,
  gross_annualized numeric,
  monthly_net_effective numeric,
  annualized_net_rent numeric,
  annual_net_psf numeric,
  application_date date,
  signed_date date,
  base_gross_rent numeric,
  outdoor_space text,
  net_op numeric,
  gross_op numeric,
  direction text,
  primary key (batch_id, building, unit_id),
  check (btrim(building) <> '' and btrim(unit_id) <> ''),
  check (inventory_category in ('Market', 'Affordable')),
  check (lease_status is not null and btrim(lease_status) <> '')
);
alter table public.tra_inventory_batches enable row level security;
alter table public.tra_inventory_units enable row level security;
create policy inventory_batch_read on public.tra_inventory_batches for select to authenticated using (exists(select 1 from public.tra_inventory_access where user_id = auth.uid()));
create policy inventory_unit_read on public.tra_inventory_units for select to authenticated using (exists(select 1 from public.tra_inventory_access where user_id = auth.uid()));
revoke all on public.tra_inventory_access, public.tra_inventory_batches, public.tra_inventory_units from public, anon, authenticated;
grant select on public.tra_inventory_access, public.tra_inventory_batches, public.tra_inventory_units to authenticated;
grant all on public.tra_inventory_access, public.tra_inventory_batches, public.tra_inventory_units to service_role;

create function public.tra_publish_inventory(p_units jsonb, p_issues jsonb, p_revision text, p_total integer, p_market integer, p_affordable integer)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  new_batch uuid;
  existing_batch uuid;
  actual_total integer;
  actual_market integer;
  actual_affordable integer;
begin
  -- Serialize publication; previous complete batches remain readable for pinned clients.
  perform pg_advisory_xact_lock(517384133);
  if jsonb_typeof(p_units) is distinct from 'array' or jsonb_typeof(p_issues) is distinct from 'array' or nullif(btrim(p_revision),'') is null then
    raise exception 'Invalid inventory payload';
  end if;
  if p_total is null or p_market is null or p_affordable is null or p_total <= 0 or p_market < 0 or p_affordable < 0 or p_total <> p_market + p_affordable then
    raise exception 'Invalid expected category counts';
  end if;
  if exists(select 1 from jsonb_array_elements(p_units) u where jsonb_typeof(u) <> 'object') then raise exception 'Invalid unit shape'; end if;
  if exists(select 1 from jsonb_array_elements(p_units) u, jsonb_object_keys(u) k where k not in ('building', 'unit_id', 'floor', 'unit_type', 'bedrooms', 'bathrooms', 'square_feet', 'inventory_category', 'lease_status', 'gross_rent', 'free_months', 'lease_term_months', 'net_effective_rent', 'gross_rent_psf_year', 'net_rent_psf_year', 'early_occupancy_start', 'lease_start', 'early_cancellation_date', 'lease_expiration', 'actual_occupancy', 'total_free_rent', 'gross_monthly', 'gross_annualized', 'monthly_net_effective', 'annualized_net_rent', 'annual_net_psf', 'application_date', 'signed_date', 'base_gross_rent', 'outdoor_space', 'net_op', 'gross_op', 'direction')) then
    raise exception 'Unapproved inventory fields';
  end if;
  if exists(select 1 from jsonb_array_elements(p_units) u where (select count(*) from jsonb_object_keys(u)) <> 33) then raise exception 'Expected 33 fields'; end if;
  -- Only a privacy-safe issue allowlist is accepted.
  if exists(select 1 from jsonb_array_elements(p_issues) i where jsonb_typeof(i) <> 'object') then raise exception 'Invalid issue shape'; end if;
  if exists(select 1 from jsonb_array_elements(p_issues) i, jsonb_object_keys(i) k where k not in ('building','unit_id','field','csv_line','reason','source_value','workbook_cell')) then raise exception 'Unapproved issue fields'; end if;
  insert into public.tra_inventory_batches(source_revision,total_units,market_units,affordable_units,date_issues)
    values(p_revision,p_total,p_market,p_affordable,p_issues) returning id into new_batch;
  insert into public.tra_inventory_units(batch_id,building, unit_id, floor, unit_type, bedrooms, bathrooms, square_feet, inventory_category, lease_status, gross_rent, free_months, lease_term_months, net_effective_rent, gross_rent_psf_year, net_rent_psf_year, early_occupancy_start, lease_start, early_cancellation_date, lease_expiration, actual_occupancy, total_free_rent, gross_monthly, gross_annualized, monthly_net_effective, annualized_net_rent, annual_net_psf, application_date, signed_date, base_gross_rent, outdoor_space, net_op, gross_op, direction)
    select new_batch,building, unit_id, floor, unit_type, bedrooms, bathrooms, square_feet, inventory_category, lease_status, gross_rent, free_months, lease_term_months, net_effective_rent, gross_rent_psf_year, net_rent_psf_year, early_occupancy_start, lease_start, early_cancellation_date, lease_expiration, actual_occupancy, total_free_rent, gross_monthly, gross_annualized, monthly_net_effective, annualized_net_rent, annual_net_psf, application_date, signed_date, base_gross_rent, outdoor_space, net_op, gross_op, direction from jsonb_to_recordset(p_units) as x(building text, unit_id text, floor integer, unit_type text, bedrooms integer, bathrooms numeric, square_feet integer, inventory_category text, lease_status text, gross_rent numeric, free_months numeric, lease_term_months numeric, net_effective_rent numeric, gross_rent_psf_year numeric, net_rent_psf_year numeric, early_occupancy_start date, lease_start date, early_cancellation_date date, lease_expiration date, actual_occupancy numeric, total_free_rent numeric, gross_monthly numeric, gross_annualized numeric, monthly_net_effective numeric, annualized_net_rent numeric, annual_net_psf numeric, application_date date, signed_date date, base_gross_rent numeric, outdoor_space text, net_op numeric, gross_op numeric, direction text);
  select count(*),count(*) filter(where inventory_category='Market'),count(*) filter(where inventory_category='Affordable')
    into actual_total,actual_market,actual_affordable from public.tra_inventory_units where batch_id=new_batch;
  if actual_total <> p_total or actual_market <> p_market or actual_affordable <> p_affordable then raise exception 'Inventory count mismatch'; end if;
  select id into existing_batch from public.tra_inventory_batches where active and source_revision = p_revision;
  if existing_batch is not null then
    delete from public.tra_inventory_units where batch_id = new_batch;
    delete from public.tra_inventory_batches where id = new_batch;
    return existing_batch;
  end if;
  update public.tra_inventory_batches set active=false where active;
  update public.tra_inventory_batches set active=true where id=new_batch;
  return new_batch;
end;
$$;
revoke all on function public.tra_publish_inventory(jsonb,jsonb,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.tra_publish_inventory(jsonb,jsonb,text,integer,integer,integer) to service_role;
commit;
