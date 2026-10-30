import {traSupabase as db} from './tra-secure-data.js';
const root=document.getElementById('overview');
const num=n=>Number(n||0), pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'0.0%';
const money=n=>'$'+Math.round(n||0).toLocaleString('en-US');
const mean=(a,k)=>{const v=a.map(x=>num(x[k])).filter(x=>x>0);return v.length?v.reduce((x,y)=>x+y,0)/v.length:0};
const fill=(node,value)=>{if(node)node.textContent=value};
const setTable=(table,rows)=>{if(!table)return;const body=table.tBodies[0];if(!body)return;body.replaceChildren();for(const values of rows){const tr=body.insertRow();for(const value of values)fill(tr.insertCell(),value)}};
async function refreshDashboard(){
 if(!root)return;
 const {data:{user},error:authError}=await db.auth.getUser();
 if(authError||!user)throw Error('Sign in required');
 const {data:batches,error:batchError}=await db.from('tra_inventory_batches').select('id,synced_at,total_units,active').eq('active',true).order('synced_at',{ascending:false}).limit(1);
 if(batchError||!batches?.length)throw Error('No active validated inventory batch');
 const batch=batches[0],rows=[];
 for(let from=0;;from+=500){
  const {data,error}=await db.from('tra_inventory_units').select('inventory_category,lease_status,unit_type,bedrooms,gross_rent,net_effective_rent,gross_annualized,annualized_net_rent').eq('batch_id',batch.id).range(from,from+499);
  if(error)throw error;
  rows.push(...(data||[]));if(!data||data.length<500)break;
 }
 if(rows.length!==batch.total_units)throw Error('Incomplete inventory: '+rows.length+' of '+batch.total_units);
 const market=rows.filter(r=>r.inventory_category==='Market'), affordable=rows.filter(r=>r.inventory_category==='Affordable');
 const signed=rows.filter(r=>r.lease_status==='Signed'),ms=market.filter(r=>r.lease_status==='Signed');
 const available=rows.filter(r=>r.lease_status==='Available');
 const kpis=root.querySelectorAll(':scope > .tra-kpis .tra-kpi strong');
 [rows.length,market.length,affordable.length,signed.length,available.length,pct(ms.length,market.length)].forEach((v,i)=>fill(kpis[i],v));
 const chart=root.querySelector('.tra-extra-charts');
 const progress=chart?.querySelector('.tra-extra-card:first-child');
 const rate=100*signed.length/rows.length;
 fill(progress?.querySelector('.sub'),signed.length+' signed of '+rows.length+' total apartments · '+pct(signed.length,rows.length));
 const donut=progress?.querySelector('.tra-donut');if(donut)donut.style.background='conic-gradient(#ac8947 0 '+rate+'%,#f8f4ed '+rate+'% 100%)';
 fill(progress?.querySelector('.tra-donut-label strong'),pct(signed.length,rows.length));
 const legend=progress?.querySelectorAll('.tra-legend > div')||[];
 fill(legend[0],'Signed: '+signed.length);fill(legend[1],'Other statuses: '+(rows.length-signed.length));
 fill(legend[2],'Market signed: '+ms.length+' / '+market.length+' ('+pct(ms.length,market.length)+')');
 const types=[['Studio',r=>/studio|stu/i.test(r.unit_type||'')||r.bedrooms===0],['1BR',r=>r.bedrooms===1],['2BR',r=>r.bedrooms===2],['3BR',r=>r.bedrooms>=3]];
 const lines=chart?.querySelectorAll('.tra-extra-card:nth-child(2) .tra-barline')||[];
 types.forEach(([name,test],i)=>{const all=market.filter(test),n=all.filter(r=>r.lease_status==='Signed').length,ratio=all.length?100*n/all.length:0;const bar=lines[i];if(!bar)return;fill(bar.querySelector('span'),name);fill(bar.querySelector('b'),pct(n,all.length));bar.querySelector('.tra-fill').style.width=ratio+'%'});
 const panels=[...root.querySelectorAll(':scope > .tra-panel')];
 const statuses=['Available','Pending','Approved','Signed','Off Market','Model','Not Available'];
 const statusRows=statuses.map(s=>{const a=rows.filter(r=>r.lease_status===s);return[s,a.length,pct(a.length,rows.length),money(mean(a,'gross_rent')),money(mean(a,'net_effective_rent'))]});
 setTable(panels[0]?.querySelector('table'),statusRows);
 const pulse=panels[1]?.querySelectorAll('.tra-kpi strong')||[];
 const annualGross=signed.reduce((v,r)=>v+num(r.gross_annualized),0),annualNet=signed.reduce((v,r)=>v+num(r.annualized_net_rent),0);
 [money(annualGross),money(annualNet),money(mean(signed,'gross_rent')),money(mean(signed,'net_effective_rent'))].forEach((v,i)=>fill(pulse[i],v));
 const typeRows=types.map(([name,test])=>{const a=market.filter(test);return[name,a.length,a.filter(r=>r.lease_status==='Available').length,a.filter(r=>r.lease_status==='Pending').length,a.filter(r=>r.lease_status==='Signed').length,pct(a.filter(r=>r.lease_status==='Signed').length,a.length)]});
 typeRows.push(['TOTAL',market.length,market.filter(r=>r.lease_status==='Available').length,market.filter(r=>r.lease_status==='Pending').length,ms.length,pct(ms.length,market.length)]);
 setTable(panels[2]?.querySelector('table'),typeRows);
 const stamp=new Date(batch.synced_at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'});
 fill(root.querySelector('.headline .eyebrow'),'Society Brooklyn / Active inventory');
 fill(root.querySelector('.headline .chip'),'Inventory synced '+stamp+' ET');
 const detail=root.querySelector('#market-performance-summary small');
 fill(detail,'Active inventory · synced '+stamp+' ET');
 const statusMarket=statuses.map(s=>{const a=market.filter(r=>r.lease_status===s);return[s,a.length,pct(a.length,market.length),money(mean(a,'gross_rent')),money(mean(a,'net_effective_rent')),money(a.reduce((v,r)=>v+num(r.gross_annualized),0))]});
 const allTables=[...root.querySelectorAll('table')];
 setTable(allTables[3],statusMarket);
 setTable(allTables[4],types.map(([name,test])=>{const a=market.filter(test);return[name,a.length,a.filter(r=>r.lease_status==='Available').length,a.filter(r=>r.lease_status==='Signed').length,money(mean(a,'gross_rent')),money(mean(a,'net_effective_rent'))]}));
 // The rent-per-SF table remains a workbook snapshot until its precise source mapping is validated.
 const note=root.querySelector('.tra-note');fill(note,'Live inventory status, rents and occupancy are calculated from the active validated inventory batch. Rent per SF below remains the October 25 workbook snapshot.');
}
async function start(){try{await refreshDashboard()}catch(e){console.warn('TRA dashboard sync:',e);const chip=root?.querySelector('.headline .chip');fill(chip,'Workbook snapshot · Live sync unavailable')}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)start()});
setInterval(()=>{if(!document.hidden)start()},60000);
