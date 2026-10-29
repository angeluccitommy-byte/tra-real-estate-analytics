import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {kpis,selectRows,loadInventory,FIELDS} from '../master-inventory.mjs';
const rows=JSON.parse(readFileSync('/tmp/tra-inventory-dry-run/inventory-candidate.json'));
const defaults={category:'Market',sort:'building',direction:'asc'};
test('Market, Affordable and All category KPIs and filters',()=>{
 const market=rows.filter(r=>r.inventory_category==='Market');
 assert.equal(kpis(selectRows(rows,defaults)).total,384);
 assert.equal(kpis(market).signed,market.filter(r=>r.lease_status==='Signed').length);
 assert.equal(kpis(selectRows(rows,{...defaults,category:'Affordable'})).total,133);
 assert.equal(selectRows(rows,{...defaults,category:''}).length,517);
 const filtered=selectRows(rows,{...defaults,building:'TEST-BUILDING-A',status:'Signed',layout:'Fixture 1BR',search:' TEST- '});
 assert.ok(filtered.length>0);assert.ok(filtered.every(r=>r.building==='TEST-BUILDING-A'&&r.lease_status==='Signed'&&r.unit_type==='Fixture 1BR'));
 assert.equal(selectRows(rows,{...defaults,search:'no-such-apartment'}).length,0);
});
test('numeric and natural sorting, nulls stay last in both directions',()=>{
 const data=[{building:'D',unit_id:'TEST-10',gross_rent:100},{building:'D',unit_id:'TEST-2',gross_rent:20},{building:'D',unit_id:'TEST-1',gross_rent:null}];
 assert.deepEqual(selectRows(data,{sort:'unit_id'}).map(r=>r.unit_id),['TEST-1','TEST-2','TEST-10']);
 assert.deepEqual(selectRows(data,{sort:'gross_rent',direction:'asc'}).map(r=>r.gross_rent),[20,100,null]);
 assert.deepEqual(selectRows(data,{sort:'gross_rent',direction:'desc'}).map(r=>r.gross_rent),[100,20,null]);
});
function client(failPage=false,duplicate=false){
 const pinned=[];
 return {pinned,from(table){let offset=0;return {select(fields){if(table==='tra_inventory_units')assert.equal(fields,FIELDS.join(','));return this},eq(field,value){if(field==='batch_id')pinned.push(value);return this},order(){return this},single(){return Promise.resolve({data:{id:'batch-1',total_units:517,market_units:384,affordable_units:133}})},range(start,end){offset=start;if(failPage&&start===200)return Promise.resolve({error:new Error('failed')});const data=rows.slice(start,end+1);if(duplicate&&start===200)data[0]=rows[0];return Promise.resolve({data})}}}};
}
test('all pages use the same batch, private fields excluded, failures reject partial data',async()=>{
 const c=client();assert.equal((await loadInventory(c)).rows.length,517);assert.deepEqual(c.pinned,['batch-1','batch-1','batch-1']);
 await assert.rejects(loadInventory(client(true)),/incomplete/);
 await assert.rejects(loadInventory(client(false,true)),/completeness/);
});
test('unvalidated bootstrap displays a safe unavailable state',async()=>{
 const {mountValidatedInventory}=await import('../bootstrap.mjs');
 const notice={},retry={};
 const root={dataset:{},innerHTML:'',querySelector:selector=>selector==='[role="status"]'?notice:retry};
 assert.deepEqual(await mountValidatedInventory({rpc:async()=>({data:false})},root),{mounted:false});
 assert.deepEqual(await mountValidatedInventory({rpc:async()=>({error:new Error('not deployed')})},root),{mounted:false});
 assert.deepEqual(await mountValidatedInventory({rpc:async()=>{throw new Error('network')}},root),{mounted:false});
 assert.equal(root.dataset.inventoryState,'unavailable');
 assert.ok(root.innerHTML.includes('Master Inventory'));
 assert.equal(typeof retry.onclick,'function');
});
