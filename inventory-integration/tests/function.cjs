// Execute the actual new Edge Function with mocked platform/transport boundaries.
const {build}=require('esbuild');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const utils={encode_col(index){let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s},decode_range(ref){const match=/([A-Z]+)(\d+)/.exec(ref.split(':').at(-1));let c=0;for(const letter of match[1])c=c*26+letter.charCodeAt(0)-64;return {e:{r:+match[2]-1,c:c-1}}}};
 const loadBook=()=>JSON.parse(fs.readFileSync('/tmp/tra-inventory-synthetic-book.json'));
 let fixture;
 function tagged(strings,...values){
  const text=strings.join('?');fixture.queries.push({text,values});
  if(text.includes("name='tra_inventory_invocation'"))return Promise.resolve([{decrypted_secret:'test-inventory-hook'}]);
  if(text.includes('pg_try_advisory_lock'))return Promise.resolve([{acquired:true}]);
  if(text.includes('select * from tra_inventory_private.runtime'))return Promise.resolve([{enabled:!fixture.disabled,source_etag:fixture.unchanged?'tag-1':null}]);
  if(text.includes('select tenant_id,client_id,drive_id,item_id'))return Promise.resolve([{tenant_id:'test-tenant',client_id:'test-client',drive_id:'test-drive',item_id:'test-item'}]);
  if(text.includes("name='tra_inventory_refresh_token'"))return Promise.resolve([{id:'inventory-only-token-id',decrypted_secret:'test-inventory-refresh'}]);
  if(text.includes('public.tra_publish_inventory')){fixture.payload=values[0];fixture.issues=values[1];return Promise.resolve([{batch_id:'test-batch'}])}
  return Promise.resolve([]);
 }
 tagged.json=x=>x;tagged.release=()=>{};
 globalThis.__inventoryPool={reserve:async()=>tagged};
 globalThis.__inventoryXLSX={utils,read:()=>fixture.book};
 let handler;globalThis.Deno={env:{get:()=> 'test-only-db-selector'},serve:fn=>{handler=fn}};
 globalThis.fetch=async(url,options={})=>{
  fixture.requests.push({url,options});
  if(url.includes('login.microsoftonline.com')){
   assert.equal(options.body.get('refresh_token'),'test-inventory-refresh');
   return Response.json({access_token:'test-access',refresh_token:'test-new-inventory-refresh'});
  }
  if(url.endsWith('/content'))return new Response(new Uint8Array([1,2,3]));
  fixture.metadataCalls++;
  return Response.json({eTag:fixture.changed&&fixture.metadataCalls>1?'tag-2':'tag-1',lastModifiedDateTime:'2026-10-29T00:00:00Z',size:1000});
 };
 const output=await build({entryPoints:['supabase/functions/tra-inventory-sync/index.ts'],bundle:true,platform:'neutral',format:'esm',write:false,plugins:[{name:'test-platform',setup(b){
  b.onResolve({filter:/^npm:postgres/},()=>({path:'postgres',namespace:'test'}));
  b.onResolve({filter:/\/vendor\/xlsx.mjs$/},()=>({path:'xlsx',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='postgres'?'export default ()=>globalThis.__inventoryPool':'export const utils=globalThis.__inventoryXLSX.utils; export const read=(...args)=>globalThis.__inventoryXLSX.read(...args);',loader:'js'}));
 }}]});
 await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
 const reset=overrides=>{fixture={book:loadBook(),queries:[],requests:[],metadataCalls:0,...overrides}};
 const request=token=>new Request('https://example.invalid',{method:'POST',headers:{'x-inventory-invocation':token||'test-inventory-hook'}});
 reset();let response=await handler(request('wrong'));assert.equal(response.status,401);assert.equal(fixture.requests.length,0);
 reset({disabled:true});response=await handler(request());assert.equal(response.status,409);assert.equal(fixture.requests.length,0);
 reset();response=await handler(request());assert.equal(response.status,200);assert.equal(fixture.payload.length,517);assert.equal(fixture.issues.length,1);
 assert.ok(fixture.queries.some(q=>q.text.includes('vault.update_secret')&&q.values[0]==='inventory-only-token-id'));
 assert.ok(!fixture.queries.some(q=>q.text.includes('tra_onedrive_refresh_token')||/update tra_sync\.|insert into (public.tra_metrics|public.tra_expiration_records|public.tra_report_snapshots)/i.test(q.text)));
 reset({changed:true});response=await handler(request());assert.equal(response.status,503);assert.equal(fixture.payload,undefined);
 reset({unchanged:true});response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).status,'unchanged');assert.equal(fixture.payload,undefined);
 reset();for(const cell of Object.values(fixture.book.Sheets['Master Inventory']))if(['1/2/999'].includes(cell.v))cell.v=61;
 response=await handler(request());assert.equal(response.status,200);assert.equal(fixture.issues.length,0);assert.equal(fixture.payload.length,517);
 console.log('Actual Edge handler passed: unauthorized/disabled guard, separate token rotation/state, 517-unit publication, accepted synthetic date flag, synthetic zero-flag correction, eTag race rejection, unchanged skip, no existing sync writes');
})().catch(error=>{console.error(error);process.exitCode=1});
