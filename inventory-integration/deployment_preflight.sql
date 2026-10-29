-- Read-only, metadata/presence only. Never outputs decrypted secrets or identifiers.
select
  has_schema_privilege(current_user,'public','CREATE') as may_create_new_tables_functions,
  has_database_privilege(current_user,current_database(),'CREATE') as may_create_private_schema,
  has_table_privilege(current_user,'auth.users','REFERENCES') as may_reference_auth_users,
  has_table_privilege(current_user,'tra_sync.connection','SELECT') as may_read_workbook_identifiers,
  has_table_privilege(current_user,'vault.decrypted_secrets','SELECT') as may_read_inventory_vault_bindings,
  exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='vault' and p.proname='update_secret' and has_function_privilege(current_user,p.oid,'EXECUTE')) as may_rotate_inventory_token,
  exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='cron' and p.proname='schedule' and has_function_privilege(current_user,p.oid,'EXECUTE')) as may_create_separate_cron_job,
  exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='cron' and p.proname='alter_job' and has_function_privilege(current_user,p.oid,'EXECUTE')) as may_disable_new_job,
  exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='net' and p.proname='http_post' and has_function_privilege(current_user,p.oid,'EXECUTE')) as may_invoke_new_hook,
  exists(select 1 from pg_extension where extname='pg_cron') as cron_available,
  exists(select 1 from pg_extension where extname='pg_net') as net_available;
select
  exists(select 1 from cron.job where jobid=1 and jobname='tra-onedrive-sync' and schedule='*/5 * * * *' and active) as existing_sync_still_active,
  exists(select 1 from tra_sync.connection where singleton and tenant_id is not null and client_id is not null and drive_id is not null and item_id is not null) as workbook_identifiers_present,
  (select count(*)=1 from vault.secrets where name='tra_inventory_invocation') as inventory_hook_present,
  (select count(*)=1 from vault.secrets where name='tra_inventory_refresh_token') as independent_inventory_refresh_binding_present;
