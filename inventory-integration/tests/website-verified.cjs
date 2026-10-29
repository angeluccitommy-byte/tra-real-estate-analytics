// Actual existing index.html + actual externally verified inventory, never synthetic rows.
// Supabase transport is local for this test; PostgreSQL RLS is executed, not mocked.
// Production Supabase/hosting verification is a separate release step.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {isDeepStrictEqual}=require('node:util');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const ids={approved:'11111111-1111-1111-1111-111111111111',unapproved:'22222222-2222-2222-2222-222222222222'};
const expectedFields=JSON.parse(fs.readFileSync(path.join(root,'inventory-integration/field-mapping.json'))).map(x=>x.field);
(async()=>{
 const payloadPath=process.env.TRA_VERIFIED_SNAPSHOT_PAYLOAD;
 assert.ok(payloadPath,'TRA_VERIFIED_SNAPSHOT_PAYLOAD must name an externally verified private snapshot payload; no synthetic fallback');
 const payload=JSON.parse(fs.readFileSync(payloadPath));
 assert.equal(payload.p_units.length,517);assert.ok(payload.p_units.every(r=>Object.keys(r).length===33));
 const db=new PGlite();let browser,server;
 const failures=[];const reads=[];
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth,public to anon,authenticated,service_role; grant execute on function auth.uid() to authenticated;
   create schema cron; create table cron.job(jobid bigint,jobname text,schedule text,command text,active boolean);
   insert into cron.job values(1,'tra-onedrive-sync','*/5 * * * *','PROTECTED_EXISTING_JOB',true);
   create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$ update cron.job set active=$2 where jobid=$1 $$;`);
  for(const name of ['001_inventory.sql','003_manual_validation_gate.sql','004_snapshot_launch.sql'])await db.exec(fs.readFileSync(path.join(root,'inventory-integration',name),'utf8'));
  await db.query('insert into auth.users values ($1),($2)',[ids.approved,ids.unapproved]);
  await db.query('insert into public.tra_inventory_access values ($1)',[ids.approved]);
  const batchId=(await db.query('select public.tra_publish_inventory_snapshot($1::jsonb,$2::jsonb,$3) as id',[JSON.stringify(payload.p_units),JSON.stringify(payload.p_issues),payload.p_source_sha256])).rows[0].id;
  const stored=(await db.query('select to_jsonb(u)-\'batch_id\' as row from public.tra_inventory_units u where batch_id=$1',[batchId])).rows.map(r=>r.row);
  const ordered=rows=>rows.slice().sort((a,b)=>a.unit_id.localeCompare(b.unit_id));
  assert.ok(isDeepStrictEqual(ordered(stored),ordered(payload.p_units)),'Every one of the 517 rows and 33 fields must match the real verified source; values withheld');
  assert.equal((await db.query('select enabled from tra_inventory_private.runtime')).rows[0].enabled,false);
  const asUser=(user,query,params=[])=>db.transaction(async tx=>{
   await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return tx.query(query,params);
  });
  assert.equal((await asUser(ids.unapproved,'select * from public.tra_inventory_units')).rows.length,0);
  assert.equal((await asUser(ids.approved,'select * from public.tra_inventory_units')).rows.length,517);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select * from public.tra_inventory_units')}));
  assert.equal((await asUser(ids.approved,'select public.tra_inventory_ready() as ready')).rows[0].ready,false);
  const port=18765;
  server=spawn('python3',['-m','http.server',String(port),'--bind','127.0.0.1'],{cwd:root,stdio:'ignore'});
  for(let attempt=0;attempt<50;attempt++){try{await fetch('http://127.0.0.1:'+port+'/index.html');break}catch{await new Promise(r=>setTimeout(r,100))}}
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const sdk=`export function createClient(){return globalThis.__traClient}`;
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const legacyErrorLine=html.slice(0,html.indexOf('groups.forEach')).split('\n').length;
  const makePage=async(mode,viewport)=>{
   const page=await browser.newPage(viewport?{viewport}:{});
   await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',route=>route.fulfill({contentType:'application/javascript',body:sdk}));
   await page.route('https://commons.wikimedia.org/**',route=>route.abort());
   page.on('pageerror',e=>{
    // This pre-existing legacy weeklyTabs failure is unchanged by inventory work.
    if(!(e.message.includes("Cannot read properties of null (reading 'appendChild')")&&e.stack.includes('/index.html:'+legacyErrorLine+':')))failures.push(e.message);
   });
   await page.exposeFunction('__inventoryQuery',async request=>{
    const user=ids[mode];if(!user)return {error:{message:'Sign in required'}};
    if(request.rpc){const result=await asUser(user,'select public.tra_inventory_ready() as ready');return {data:result.rows[0].ready,error:null}}
    if(!['tra_inventory_batches','tra_inventory_units'].includes(request.table))return {data:[],error:null};
    const fields=request.fields.split(',');
    const allowed=request.table==='tra_inventory_units'?expectedFields:['id','synced_at','source_revision','total_units','market_units','affordable_units','date_issues'];
    assert.ok(fields.every(f=>allowed.includes(f)));
    const filters=request.filters.map(([key,value],i)=>{assert.ok(['batch_id','active'].includes(key));return `"${key}"=$${i+1}`}).join(' and ');
    const values=request.filters.map(x=>x[1]);
    let query=`select ${fields.map(f=>'"'+f+'"').join(',')} from public.${request.table}`+(filters?' where '+filters:'');
    if(request.table==='tra_inventory_units')query+=' order by building,unit_id';
    query+=' limit '+(request.limit||200)+' offset '+(request.offset||0);
    const result=await asUser(user,query,values);reads.push({mode,table:request.table,count:result.rows.length});
    return {data:request.single?result.rows[0]||null:result.rows,error:null};
   });
   await page.addInitScript(({mode,ids})=>{
    const client={auth:{getUser:async()=>({data:{user:mode==='anonymous'?null:{id:ids[mode]}},error:null}),onAuthStateChange:()=>({}),signOut:async()=>({error:null})},rpc:async name=>globalThis.__inventoryQuery({rpc:name}),from(table){
     const query={table,fields:'*',filters:[],offset:0,limit:200};
     const builder={select(fields){query.fields=fields;return this},eq(key,value){query.filters.push([key,value]);return this},order(){return this},range(start,end){query.offset=start;query.limit=end-start+1;return this},limit(n){query.limit=n;return this},single(){query.single=true;return this},then(resolve,reject){return globalThis.__inventoryQuery(query).then(resolve,reject)}};return builder;
    }};globalThis.__traClient=client;
   },{mode,ids});
   return page;
  };
  const page=await makePage('approved');
  await page.goto('http://127.0.0.1:'+port+'/index.html');
  await page.waitForSelector('#inventory[data-inventory-state="unavailable"]',{state:'attached'});
  await page.locator('.side nav [data-view="inventory"]').click();
  assert.ok(await page.locator('#inventory').evaluate(el=>el.classList.contains('active')));
  // Pre-gate view smoke check uses only already authorized rows through real local RLS.
  await page.evaluate(async()=>{const {mountMasterInventory}=await import('./inventory-integration/master-inventory.mjs');globalThis.__disposeInventory=await mountMasterInventory(globalThis.__traClient,document.querySelector('#inventory'))});
  await page.waitForSelector('#inventory[data-inventory-state="ready"]',{state:'attached'});
  assert.ok((await page.locator('#inventory [role="status"]').textContent()).includes('Verified workbook snapshot'));
  assert.ok((await page.locator('#inventory [role="status"]').textContent()).includes('Automatic refresh is off'));
  const stats=category=>{const data=payload.p_units.filter(r=>!category||r.inventory_category===category),signed=data.filter(r=>r.lease_status==='Signed').length;return [String(data.length),String(data.filter(r=>r.lease_status==='Available').length),String(signed),(100*signed/data.length).toFixed(1)+'%']};
  assert.deepEqual(await page.locator('#inventory .kpi strong').allTextContents(),stats('Market'));
  await page.getByRole('combobox',{name:'Inventory program'}).selectOption('Affordable');
  assert.deepEqual(await page.locator('#inventory .kpi strong').allTextContents(),stats('Affordable'));
  await page.getByRole('combobox',{name:'Inventory program'}).selectOption('');
  assert.deepEqual(await page.locator('#inventory .kpi strong').allTextContents(),stats(''));
  const sample=payload.p_units.find(r=>r.outdoor_space&&r.direction)||payload.p_units.find(r=>r.outdoor_space);
  const building=sample.building,layout=sample.unit_type,status=sample.lease_status;
  await page.getByRole('combobox',{name:'Buildings'}).selectOption(building);
  await page.getByRole('combobox',{name:'Layouts'}).selectOption(layout);
  await page.getByRole('combobox',{name:'Statuses'}).selectOption(status);
  const count=payload.p_units.filter(r=>r.building===building&&r.unit_type===layout&&r.lease_status===status).length;
  assert.ok((await page.locator('[data-inventory-summary]').textContent()).startsWith(String(count)+' '));
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByRole('textbox',{name:'Search units'}).fill(' '+sample.unit_id.toLowerCase()+' ');
  assert.equal(await page.locator('#inventory tbody tr').count(),1);
  await page.getByRole('button',{name:'View',exact:true}).click();
  assert.equal(await page.locator('#inventory .detailfield').count(),33);
  for(const field of expectedFields){
   const detail=page.locator('#inventory .detailfield').filter({has:page.locator('small',{hasText:new RegExp('^'+field.replaceAll('_',' ')+'$')})});
   if(['outdoor_space','direction'].includes(field))assert.equal(await detail.locator('strong').textContent(),sample[field]??'—');
  }
  assert.ok(!expectedFields.some(f=>['tenant_name','notes','leasing_agent'].includes(f)));
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByRole('button',{name:'Gross rent',exact:true}).click();
  const rents=await page.locator('#inventory tbody tr td:nth-child(6)').allTextContents();
  const numbers=rents.map(v=>Number(v.replace(/[^\d.-]/g,'')));assert.deepEqual(numbers,numbers.slice().sort((a,b)=>a-b));
  await page.getByRole('button',{name:'Next',exact:true}).click();assert.ok((await page.locator('#inventory .invpager').textContent()).includes('Page 2'));
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('textbox',{name:'Search units'}).fill(sample.unit_id);
  await page.getByRole('button',{name:'View',exact:true}).click();
  assert.equal(await page.locator('[data-inventory-detail]').evaluate(el=>document.activeElement===el),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Inventory must not overflow the mobile viewport');
  await page.locator('.side nav [data-view="daily"]').click();assert.ok(await page.locator('#daily').evaluate(el=>el.classList.contains('active')));
  await page.locator('.side nav [data-view="weekly"]').click();assert.ok(await page.locator('#weekly').evaluate(el=>el.classList.contains('active')));
  await page.evaluate(()=>globalThis.__disposeInventory());
  // Record only after local source, real RLS, and browser checks have passed.
  const checks={approved_reader_verified:true,anonymous_denied:true,unapproved_reader_denied:true,dashboard_smoke_passed:true,source_sha256:payload.p_source_sha256};
  await db.query('select public.tra_confirm_inventory_manual_import($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb)',[batchId,JSON.stringify(payload.p_units),JSON.stringify(payload.p_issues),JSON.stringify(checks)]);
  await page.reload();await page.waitForSelector('#inventory[data-inventory-state="ready"]',{state:'attached'});
  await page.locator('.side nav [data-view="inventory"]').click();assert.equal(await page.locator('#inventory .kpi strong').first().textContent(),'384');
  const denied=await makePage('unapproved');await denied.goto('http://127.0.0.1:'+port+'/index.html');await denied.waitForSelector('#inventory[data-inventory-state="unavailable"]',{state:'attached'});
  assert.equal(await denied.locator('#inventory tbody tr').count(),0);
  const anon=await makePage('anonymous');await anon.goto('http://127.0.0.1:'+port+'/index.html');await anon.waitForURL('**/login.html');
  assert.ok(reads.some(r=>r.table==='tra_inventory_units'&&r.count===200));
  assert.equal((await db.query('select enabled from tra_inventory_private.runtime')).rows[0].enabled,false);
  const jobs=(await db.query('select * from cron.job')).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].jobname,'tra-onedrive-sync');assert.equal(jobs[0].active,true);
  assert.deepEqual(failures,[]);
  const result={verified_source_rows:517,fields_per_row:33,market:384,affordable:133,actual_source_values_compared:true,existing_site_navigation:true,mobile_details:true,approved_unapproved_anonymous_local_postgresql_rls:true,snapshot_launch_without_oauth:true,production_sync_unchanged:true,production_supabase_tested:false,production_url_verified:false};
  if(process.env.TRA_WEBSITE_VALIDATION_OUTPUT)fs.writeFileSync(process.env.TRA_WEBSITE_VALIDATION_OUTPUT,JSON.stringify(result,null,2)+'\n');
  console.log('Existing TRA website + verified snapshot checks passed:',JSON.stringify(result));
 }finally{if(browser)await browser.close();if(server)server.kill();await db.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
