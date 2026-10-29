const {chromium}=require('playwright');
const fs=require('fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<section id="inventory"></section>');
  const rows=JSON.parse(fs.readFileSync(process.env.TRA_INVENTORY_CANDIDATE||'/tmp/tra-inventory-dry-run/inventory-candidate.json'));
  const code=fs.readFileSync('inventory-integration/master-inventory.mjs','utf8');
  const batch=process.env.TRA_INVENTORY_BATCH_METADATA?JSON.parse(fs.readFileSync(process.env.TRA_INVENTORY_BATCH_METADATA)):null;
  await page.evaluate(async({rows,code,batch})=>{
   const moduleURL=URL.createObjectURL(new Blob([code],{type:'text/javascript'})); const m=await import(moduleURL); URL.revokeObjectURL(moduleURL);
   const client={from(table){return {select(){return this},eq(){return this},order(){return this},single(){return Promise.resolve({data:batch||{id:'test-batch',synced_at:'2026-10-29T00:00:00Z',total_units:517,market_units:384,affordable_units:133,date_issues:[{}]}})},range(start,end){return Promise.resolve({data:rows.slice(start,end+1)})}}}};
   window.disposeInventory=await m.mountMasterInventory(client,document.querySelector('#inventory'));
  },{rows,code,batch});
  const expectedStats=category=>{const subset=rows.filter(r=>r.inventory_category===category);const signed=subset.filter(r=>r.lease_status==='Signed').length;return [String(subset.length),String(subset.filter(r=>r.lease_status==='Available').length),String(signed),(100*signed/subset.length).toFixed(1)+'%']};
  assert.deepEqual(await page.locator('.kpi strong').allTextContents(),expectedStats('Market'));
  assert.equal(await page.locator('tbody tr').count(),18);
  assert.equal(await page.getByRole('button',{name:'Previous',exact:true}).isDisabled(),true);
  await page.getByRole('combobox',{name:'Inventory program'}).selectOption('Affordable');
  assert.deepEqual(await page.locator('.kpi strong').allTextContents(),expectedStats('Affordable'));
  await page.getByRole('combobox',{name:'Inventory program'}).selectOption('');
  assert.equal(await page.locator('.kpi strong').first().textContent(),'517');
  const dated=rows.find(r=>r.lease_start!=null&&r.actual_occupancy!=null);assert.ok(dated);
  await page.getByRole('textbox',{name:'Search units'}).fill(' '+dated.unit_id+' ');
  assert.equal(await page.locator('tbody tr').count(),1);
  await page.getByRole('button',{name:'View',exact:true}).click();
  assert.equal(await page.locator('.detailfield').count(),33);
  const lease=page.locator('.detailfield').filter({has:page.locator('small',{hasText:/^lease start$/})});
  assert.equal(await lease.locator('strong').textContent(),dated.lease_start);
  const occupancy=page.locator('.detailfield').filter({has:page.locator('small',{hasText:/^actual occupancy$/})});
  assert.ok(/^\d+(\.\d+)?$/.test(await occupancy.locator('strong').textContent()));
  for(const field of ['outdoor_space','direction']) {
   const sample=rows.find(r=>r[field]!=null); assert.ok(sample,field+' fixture must be populated');
   await page.getByRole('textbox',{name:'Search units'}).fill(sample.unit_id);
   await page.getByRole('button',{name:'View',exact:true}).click();
   const detail=page.locator('.detailfield').filter({has:page.locator('small',{hasText:new RegExp('^'+field.replaceAll('_',' ')+'$')})});
   assert.equal(await detail.locator('strong').textContent(),String(sample[field]));
  }
  const undated=rows.find(r=>r.lease_expiration==null);assert.ok(undated);
  await page.getByRole('textbox',{name:'Search units'}).fill(undated.unit_id);
  await page.getByRole('button',{name:'View',exact:true}).click();
  assert.equal(await page.locator('.detailfield').filter({has:page.locator('small',{hasText:/^lease expiration$/})}).locator('strong').textContent(),'—');
  await page.getByRole('textbox',{name:'Search units'}).fill('nonexistent apartment');
  assert.ok((await page.locator('tbody').textContent()).includes('No matching'));
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  assert.equal(await page.locator('tbody tr').count(),18);
  await page.getByRole('button',{name:'Gross rent',exact:true}).click();
  assert.equal(await page.locator('th[aria-sort="ascending"]').innerText(),'Gross rent');
  await page.getByRole('button',{name:'Gross rent',exact:true}).click();
  assert.equal(await page.locator('th[aria-sort="descending"]').innerText(),'Gross rent');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  assert.ok((await page.locator('.invpager').innerText()).includes('Page 2'));
  await page.evaluate(()=>window.disposeInventory());
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: category KPIs, full batch, search, details, invalid dates, numeric occupancy, reset, sorting, pagination, no page errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
