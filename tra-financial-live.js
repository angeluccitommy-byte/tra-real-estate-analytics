import {traSupabase as db} from './tra-secure-data.js';
const root=document.getElementById('financial');
const number=v=>Number(v)||0;
const money=v=>'$'+Math.round(v||0).toLocaleString('en-US');
const compact=v=>Math.abs(v)>=1e6?'$'+(v/1e6).toFixed(2)+'M':money(v);
const pct=(a,b)=>b?(100*a/b).toFixed(1)+'%':'0.0%';
const average=(rows,key)=>{const values=rows.map(r=>number(r[key])).filter(n=>n>0);return values.length?values.reduce((a,b)=>a+b,0)/values.length:0};
const write=(el,val)=>{if(el)el.textContent=val};
const table=(el,rows)=>{const body=el?.tBodies?.[0];if(!body)return;body.replaceChildren();for(const values of rows){const tr=body.insertRow();for(const value of values)write(tr.insertCell(),value)}};
const statuses=['Available','Pending','Approved','Signed','Off Market','Model','Not Available'];
const types=[['Studio',r=>/studio|stu/i.test(r.unit_type||'')||r.bedrooms===0],['1BR',r=>r.bedrooms===1],['2BR/2BA',r=>r.bedrooms===2],['3BR',r=>r.bedrooms>=3]];
function bar(el,value,max,label){if(!el)return;write(el.querySelector('b'),label);const fill=el.querySelector('.tra-fill,.exec-fill');if(fill)fill.style.width=(max>0?Math.max(0,Math.min(100,100*value/max)):0)+'%'}
async function refresh(){
 if(!root)return;
 const {data:{user},error:authError}=await db.auth.getUser();if(authError||!user)throw Error('Sign in required');
 const {data:batches,error:be}=await db.from('tra_inventory_batches').select('id,total_units,synced_at').eq('active',true).order('synced_at',{ascending:false}).limit(1);
 if(be||!batches?.length)throw Error('No active inventory batch');
 const batch=batches[0],rows=[];
 for(let from=0;;from+=500){
  const {data,error}=await db.from('tra_inventory_units').select('inventory_category,lease_status,unit_type,bedrooms,square_feet,gross_rent,net_effective_rent,gross_annualized,annualized_net_rent,gross_rent_psf_year,net_rent_psf_year').eq('batch_id',batch.id).range(from,from+499);
  if(error)throw error;rows.push(...(data||[]));if(!data||data.length<500)break;
 }
 if(rows.length!==batch.total_units)throw Error('Incomplete inventory batch');
 const market=rows.filter(r=>r.inventory_category==='Market');
 const signed=rows.filter(r=>r.lease_status==='Signed');
 const gross=signed.reduce((a,r)=>a+number(r.gross_annualized),0);
 const net=signed.reduce((a,r)=>a+number(r.annualized_net_rent),0);
 const avgGross=average(signed,'gross_rent'),avgNet=average(signed,'net_effective_rent');
 const chart=root.querySelector('.tra-extra-charts');
 const revenue=chart?.querySelectorAll('.tra-extra-card:first-child .tra-barline')||[];
 bar(revenue[0],gross,gross,compact(gross));bar(revenue[1],net,gross,compact(net));
 const byType=types.map(([name,test])=>({name,rows:market.filter(test)}));
 const maxGross=Math.max(...byType.map(x=>average(x.rows,'gross_rent')),1);
 const topBars=chart?.querySelectorAll('.tra-extra-card:nth-child(2) .tra-barline')||[];
 byType.forEach((x,i)=>bar(topBars[i],average(x.rows,'gross_rent'),maxGross,money(average(x.rows,'gross_rent'))));
 const pulse=root.querySelectorAll('.exec-grid > .exec-metric strong');
 // Portfolio rent-roll summary supplied by the owner; separate from signed-unit inventory calculations.
 const keys=['Financial Total Units','Financial Gross Monthly Rent','Financial Net Monthly Rent','Financial Annual Gross Rent','Financial Annual Net Rent'];
 const {data:financialMetrics,error:financialError}=await db.from('tra_metrics').select('metric,value,updated_at').in('metric',keys);
 if(financialError)throw financialError;
 const lookup=Object.fromEntries((financialMetrics||[]).map(r=>[r.metric,r]));
 const ready=keys.every(k=>lookup[k]&&Number.isFinite(Number(lookup[k].value))&&Number(lookup[k].value)>0);
 if(ready){
  const rentRoll={units:Number(lookup[keys[0]].value),grossMonthly:Number(lookup[keys[1]].value),netMonthly:Number(lookup[keys[2]].value),annualGross:Number(lookup[keys[3]].value),annualNet:Number(lookup[keys[4]].value)};
  [money(rentRoll.annualGross),money(rentRoll.annualNet),money(rentRoll.grossMonthly/rentRoll.units),money(rentRoll.netMonthly/rentRoll.units)].forEach((v,i)=>write(pulse[i],v));
 }
 const pulseCards=root.querySelectorAll('.exec-grid > .exec-metric');
 pulseCards.forEach((card,i)=>write(card.querySelector('small'),ready?(i<2?'OneDrive · Financial Analytics':'OneDrive monthly rent / total units'):'Workbook snapshot · awaiting OneDrive financial import'));
 const cols=root.querySelector('.exec-columns');
 const revBars=cols?.querySelectorAll('.exec-card:first-child .exec-barline')||[];
 bar(revBars[0],gross,gross,compact(gross));bar(revBars[1],net,gross,compact(net));
 write(cols?.querySelector('.exec-card:first-child p.sub'),'Annualized net is '+pct(net,gross)+' of signed-unit gross revenue in the active inventory.');
 const spread=cols?.querySelectorAll('.exec-card:nth-child(2) .exec-metric strong')||[];
 write(spread[0],money(gross-net));write(spread[1],money(avgGross-avgNet));
 const tables=root.querySelectorAll('table.exec-table');
 table(tables[0],statuses.map(s=>{const a=market.filter(r=>r.lease_status===s);return[s,a.length,pct(a.length,market.length),money(average(a,'gross_rent')),money(average(a,'net_effective_rent')),money(a.reduce((v,r)=>v+number(r.gross_annualized),0))]}));
 table(tables[1],byType.map(({name,rows:a})=>[name,a.length,a.filter(r=>r.lease_status==='Available').length,a.filter(r=>r.lease_status==='Signed').length,money(average(a,'gross_rent')),money(average(a,'net_effective_rent')),'$'+average(a,'gross_rent_psf_year').toFixed(2),'$'+average(a,'net_rent_psf_year').toFixed(2)]));
 const positioning=root.querySelectorAll('.exec-card .exec-barline');
 const last=[...positioning].slice(-4);
 byType.forEach((x,i)=>bar(last[i],average(x.rows,'gross_rent'),maxGross,money(average(x.rows,'gross_rent'))));
 const stamp=new Date(batch.synced_at).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'});
 write(root.querySelector('.headline .eyebrow'),'TRA / Society Brooklyn / Active inventory');
 write(root.querySelector('.headline .chip'),'Synced '+stamp+' ET');
 write(root.querySelector('.notice'),'Executive Financial Pulse uses OneDrive financial metrics when available; otherwise it retains the labeled workbook snapshot. Other financial sections use the active validated inventory batch · Last synced '+stamp+' ET.');
 write(chart?.querySelector('.tra-extra-card:first-child .sub'),'Signed leases · annualized');
 write(root.querySelector('.exec-section span'),'Signed portfolio · annualized and monthly averages');
 const flag=root.querySelector('.exec-flag');
 if(flag)write(flag,'Source: active validated Supabase inventory. Revenue totals use signed leases only; market-rate tables cover all market inventory statuses. Per-square-foot figures are averages of available unit-level values.');
}
async function start(){try{await refresh()}catch(e){console.warn('TRA Financial Analytics:',e);write(root?.querySelector('.headline .chip'),'Workbook snapshot · Live sync unavailable')}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
document.addEventListener('visibilitychange',()=>{if(!document.hidden)start()});
setInterval(()=>{if(!document.hidden)start()},60000);
