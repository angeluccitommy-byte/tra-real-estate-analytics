const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to authenticated;`);
  await db.exec(fs.readFileSync('inventory-integration/001_inventory.sql','utf8'));
  const units=JSON.parse(fs.readFileSync('/tmp/tra-inventory-dry-run/inventory-candidate.json'));
  const report=JSON.parse(fs.readFileSync('/tmp/tra-inventory-dry-run/inventory-validation.json'));
  let revision='fixture-1';
  const publish=async(data=units)=>db.query('select public.tra_publish_inventory($1::jsonb,$2::jsonb,$3,517,384,133) as id',[JSON.stringify(data),JSON.stringify(report.date_correction_flags),revision]);
  await db.exec('set role service_role');
  const first=(await publish()).rows[0].id;
  assert.equal((await publish()).rows[0].id,first); // unchanged workbook is idempotent
  revision='fixture-2';
  const second=(await publish()).rows[0].id;
  assert.notEqual(first,second);
  assert.equal((await db.query('select count(*)::int as n from public.tra_inventory_units where batch_id=$1',[second])).rows[0].n,517);
  assert.equal((await db.query('select count(*)::int as n from public.tra_inventory_units where batch_id=$1',[first])).rows[0].n,517);
  assert.equal((await db.query('select count(*)::int as n from public.tra_inventory_batches where active')).rows[0].n,1);
  const flaggedUnit=report.date_correction_flags[0].unit_id;
  assert.equal((await db.query('select count(*)::int as n from public.tra_inventory_units where batch_id=$1 and unit_id=$2 and lease_expiration is null',[second,flaggedUnit])).rows[0].n,1);
  for(const field of ['outdoor_space','direction']) {
    const expected=units.filter(r=>r[field]!=null).length;
    assert.ok(expected>0);
    assert.equal((await db.query(`select count(*)::int as n from public.tra_inventory_units where batch_id=$1 and ${field} is not null`,[second])).rows[0].n,expected);
  }
  for(const bad of [units.slice(1),[...units.slice(0,-1),units[0]],units.map((r,i)=>i? r:{...r,tenant_name:'forbidden'})]){
   await assert.rejects(publish(bad));
   assert.equal((await db.query('select id from public.tra_inventory_batches where active')).rows[0].id,second);
   assert.equal((await db.query('select count(*)::int as n from public.tra_inventory_batches')).rows[0].n,2);
  }
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from public.tra_inventory_units'));
  await db.exec('reset role; set role authenticated');
  assert.equal((await db.query('select * from public.tra_inventory_units')).rows.length,0);
  await assert.rejects(publish());
  const user='11111111-1111-1111-1111-111111111111';
  await db.exec(`reset role; insert into auth.users values ('${user}'); insert into public.tra_inventory_access values ('${user}'); set role authenticated; set request.jwt.claim.sub='${user}'`);
  assert.equal((await db.query('select count(*)::int as n from public.tra_inventory_units where batch_id=$1',[second])).rows[0].n,517);
  await assert.rejects(db.query('delete from public.tra_inventory_units'));
  await db.exec(`reset role;
    create schema cron; create schema vault;
    create table vault.secrets(name text); insert into vault.secrets values('tra_inventory_invocation');
    create table cron.job(jobid bigint primary key,jobname text,schedule text,command text,active boolean);
    insert into cron.job values(1,'tra-onedrive-sync','*/5 * * * *','EXISTING_PRODUCTION_COMMAND',true);
    create function cron.schedule(name text,frequency text,body text) returns bigint language plpgsql as $$ begin insert into cron.job values(2,name,frequency,body,true); return 2; end $$;
    create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$ update cron.job set active=$2 where jobid=$1 $$;
  `);
  await db.exec(fs.readFileSync('inventory-integration/002_disabled_schedule.sql','utf8'));
  assert.deepEqual((await db.query('select jobname,active,command from cron.job where jobid=1')).rows[0],{jobname:'tra-onedrive-sync',active:true,command:'EXISTING_PRODUCTION_COMMAND'});
  assert.equal((await db.query('select active from cron.job where jobid=2')).rows[0].active,false);
  await assert.rejects(db.exec(fs.readFileSync('inventory-integration/002_disabled_schedule.sql','utf8')));
  await db.exec('rollback');
  await db.exec(fs.readFileSync('inventory-integration/003_manual_validation_gate.sql','utf8'));
  await db.exec('set role authenticated');
  assert.equal((await db.query('select public.tra_inventory_ready() as ready')).rows[0].ready,false);
  await db.exec('reset role');
  assert.equal((await db.query('select active from cron.job where jobid=2')).rows[0].active,false);
  await db.exec('set role service_role');
  await assert.rejects(db.query('select tra_inventory_private.enable_validated_schedule()'));
  const checks={approved_reader_verified:true,anonymous_denied:true,unapproved_reader_denied:true,dashboard_smoke_passed:true,source_sha256:report.source_sha256};
  const confirm=async(data=units,evidence=checks)=>db.query('select public.tra_confirm_inventory_manual_import($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb)',[second,JSON.stringify(data),JSON.stringify(report.date_correction_flags),JSON.stringify(evidence)]);
  await assert.rejects(confirm()); // no actual manual Edge import state yet
  await db.exec("update tra_inventory_private.runtime set enabled=true,source_etag='fixture-2',last_success_at=now() where singleton");
  await assert.rejects(confirm(units,{...checks,dashboard_smoke_passed:false}));
  const drift=units.map((r,i)=>i?r:{...r,outdoor_space:'WRONG'});
  await assert.rejects(confirm(drift));
  await assert.rejects(db.query('select tra_inventory_private.enable_validated_schedule()'));
  await confirm();
  await db.exec('set role authenticated');
  assert.equal((await db.query('select public.tra_inventory_ready() as ready')).rows[0].ready,true);
  await db.exec('reset role; set role service_role');
  await db.query('select tra_inventory_private.enable_validated_schedule()');
  await db.exec('reset role');
  assert.equal((await db.query('select active from cron.job where jobid=2')).rows[0].active,true);
  assert.deepEqual((await db.query('select jobname,active,command from cron.job where jobid=1')).rows[0],{jobname:'tra-onedrive-sync',active:true,command:'EXISTING_PRODUCTION_COMMAND'});
  console.log('PostgreSQL checks passed: migration, 517-unit imports, flagged null dates, atomic rollback, retained batches, anonymous denial, unauthorized RLS denial, approved-user reads, client write denial, disabled cron installation, failed/successful manual gates, release readiness, Outdoor Space/Direction retention, preserved job 1');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
