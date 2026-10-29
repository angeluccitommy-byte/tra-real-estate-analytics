-- PREPARED ONLY: execute after the new Edge Function and its source adapter
-- have passed staging validation. No reference to production job ID 1.
-- New invocation secret must be provisioned securely in Vault under
-- tra_inventory_invocation. The new function reads that binding server-side.
-- Never output its value; no duplicate Edge environment variable is required.
begin;
do $$
declare inventory_job bigint;
begin
  if exists(select 1 from cron.job where jobname='tra-inventory-sync') then
    raise exception 'Separate inventory job already exists; inspect without replacing it';
  end if;
  if (select count(*) from vault.secrets where name='tra_inventory_invocation') <> 1 then
    raise exception 'Separate inventory invocation binding is required';
  end if;
  select cron.schedule('tra-inventory-sync', '*/5 * * * *', $command$
    select net.http_post(
      url := 'https://bluavamwhplpyuzeppfc.supabase.co/functions/v1/tra-inventory-sync',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-inventory-invocation',(select decrypted_secret from vault.decrypted_secrets where name='tra_inventory_invocation')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $command$) into inventory_job;
  perform cron.alter_job(inventory_job, active := false);
end;
$$;
commit;
-- No activation statement is included. After the manual checker records success,
-- only tra_inventory_private.enable_validated_schedule() may be used to enable
-- this job. Migration 003 installs that gate; it does not call it.
