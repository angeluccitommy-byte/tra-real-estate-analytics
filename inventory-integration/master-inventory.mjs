// Mounted only inside the existing authenticated TRA inventory view after its RLS/readiness gate.
export const FIELDS = ['building','unit_id','floor','unit_type','bedrooms','bathrooms','square_feet','inventory_category','lease_status','gross_rent','free_months','lease_term_months','net_effective_rent','gross_rent_psf_year','net_rent_psf_year','early_occupancy_start','lease_start','early_cancellation_date','lease_expiration','actual_occupancy','total_free_rent','gross_monthly','gross_annualized','monthly_net_effective','annualized_net_rent','annual_net_psf','application_date','signed_date','base_gross_rent','outdoor_space','net_op','gross_op','direction'];
export const COLUMNS = [['building','Building'],['unit_id','Apartment'],['unit_type','Layout'],['square_feet','SF'],['lease_status','Status'],['gross_rent','Gross rent'],['net_effective_rent','Net effective'],['free_months','Free months'],['lease_term_months','Lease term']];
const numeric = new Set(['floor','bedrooms','bathrooms','square_feet','gross_rent','free_months','lease_term_months','net_effective_rent','gross_rent_psf_year','net_rent_psf_year','actual_occupancy','total_free_rent','gross_monthly','gross_annualized','monthly_net_effective','annualized_net_rent','annual_net_psf','base_gross_rent','net_op','gross_op']);
const natural = new Intl.Collator('en-US', {numeric:true,sensitivity:'base'});
export function kpis(rows) {
  const signed=rows.filter(r=>r.lease_status==='Signed').length;
  return {total:rows.length,available:rows.filter(r=>r.lease_status==='Available').length,signed,leased:rows.length?(signed/rows.length*100).toFixed(1)+'%':'—'};
}
export function selectRows(rows,state) {
  const q=(state.search||'').trim().toLowerCase();
  return rows.filter(r=>(!state.category||r.inventory_category===state.category)&&(!state.building||r.building===state.building)&&(!state.status||r.lease_status===state.status)&&(!state.layout||r.unit_type===state.layout)&&(!q||[r.building,r.unit_id,r.unit_type].some(v=>String(v??'').toLowerCase().includes(q)))).sort((a,b)=>{
    const x=a[state.sort],y=b[state.sort];
    // Nulls stay last in both directions.
    if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;
    let value=0;
    if(x!=null&&y!=null)value=numeric.has(state.sort)?Number(x)-Number(y):natural.compare(String(x),String(y));
    return value*(state.direction==='desc'?-1:1)||natural.compare(a.building,b.building)||natural.compare(a.unit_id,b.unit_id);
  });
}
export async function loadInventory(client) {
  const {data:batch,error}=await client.from('tra_inventory_batches').select('id,synced_at,source_revision,total_units,market_units,affordable_units,date_issues').eq('active',true).single();
  if(error||!batch)throw new Error('No authorized complete inventory batch is available');
  if(!Number.isInteger(batch.total_units)||batch.total_units<=0)throw new Error('Invalid inventory batch count');
  const rows=[];
  for(let offset=0;offset<batch.total_units;offset+=200){
    const {data,error}=await client.from('tra_inventory_units').select(FIELDS.join(',')).eq('batch_id',batch.id).order('building').order('unit_id').range(offset,offset+199);
    if(error||!data?.length)throw new Error('Inventory fetch incomplete; retry');
    rows.push(...data);
  }
  const unique=new Set(rows.map(r=>JSON.stringify([r.building,r.unit_id])));
  if(rows.length!==batch.total_units||unique.size!==rows.length||rows.filter(r=>r.inventory_category==='Market').length!==batch.market_units||rows.filter(r=>r.inventory_category==='Affordable').length!==batch.affordable_units||batch.market_units+batch.affordable_units!==batch.total_units)throw new Error('Inventory batch failed completeness validation');
  if(rows.some(r=>!r.building||!r.unit_id||!r.lease_status||Object.keys(r).length!==FIELDS.length||Object.keys(r).some(k=>!FIELDS.includes(k))))throw new Error('Unexpected inventory record shape');
  return {rows,batch};
}
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const display=(value,key)=>value==null?'—':['gross_rent','net_effective_rent'].includes(key)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value):String(value);
export async function mountMasterInventory(client,root) {
  const state={category:'Market',building:'',status:'',layout:'',search:'',sort:'building',direction:'asc',page:0};
  let current, selected=null, stopped=false,refreshing=false;
  root.dataset.inventoryState='loading';
  root.innerHTML='<div class="notice" role="status">Loading authorized inventory…</div>';
  function render(){
    if(stopped)return;
    const focus=root.contains(document.activeElement)?document.activeElement?.dataset?.filter:null;
    const start=document.activeElement?.selectionStart;
    const {rows,batch}=current;
    const base=rows.filter(r=>!state.category||r.inventory_category===state.category);
    const available=(field)=>[...new Set(base.map(r=>r[field]).filter(v=>v!=null))].sort(natural.compare);
    for(const [key,field] of [['building','building'],['status','lease_status'],['layout','unit_type']])if(state[key]&&!available(field).includes(state[key]))state[key]='';
    const filtered=selectRows(rows,state),stats=kpis(base),showResults=Boolean(state.search.trim()||state.building||state.status||state.layout),pages=Math.max(1,Math.ceil(filtered.length/18));state.page=Math.min(state.page,pages-1);
    const options=(values,selected)=>values.map(([v,label])=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(label)}</option>`).join('');
    const select=(name,label,values)=>`<select aria-label="${label}" data-filter="${name}">${options([['',`All ${label.toLowerCase()}`],...values.map(v=>[v,v])],state[name])}</select>`;
    root.innerHTML=`<div class="headline"><div><div class="eyebrow">TRA / Master inventory</div><h1 id="inventory-title">Master Inventory</h1><p>Apartment-level visibility across the portfolio.</p></div><span class="chip">${esc(state.category||'All')} units</span></div>
    <div class="notice" role="status" aria-live="polite">${batch.source_revision?.startsWith('snapshot:')?'Verified workbook snapshot · Automatic refresh is off · Imported':'Workbook inventory imported'}: ${esc(new Date(batch.synced_at).toLocaleString('en-US',{timeZone:'America/New_York'}))} ET · ${batch.date_issues?.length||0} dates flagged for source correction. Invalid dates display —.</div>
    <div class="kpis">${[['Inventory',stats.total],['Available',stats.available],['Signed',stats.signed],['Leased %',stats.leased]].map(([label,value])=>`<div class="kpi"><label>${label}</label><strong>${esc(value)}</strong><div class="foot">${esc(state.category||'All')} portfolio</div></div>`).join('')}</div>
    <style>#inventory .tra-summary-table{width:100%;border-collapse:collapse;table-layout:auto}#inventory .tra-summary-table th,#inventory .tra-summary-table td{border:1px solid #d6d0c5;padding:8px 9px;white-space:nowrap;text-align:right}#inventory .tra-summary-table th:first-child,#inventory .tra-summary-table td:first-child{text-align:left}#inventory .tra-summary-table thead th{background:#142d4a;color:#fff;font-weight:700}#inventory .tra-summary-table tbody tr:nth-child(even){background:#faf9f6}#inventory .tra-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:20px}#inventory .tra-summary-grid>div{min-width:0}#inventory .tra-summary-grid .invtable{overflow-x:auto}</style><div class="panel" style="margin-bottom:16px"><div class="sectiontitle"><h2>Portfolio Inventory Summary</h2><small>Source: imported inventory snapshot · ${esc(new Date(batch.synced_at).toLocaleDateString("en-US",{timeZone:"America/New_York"}))}</small></div><div class="tra-summary-grid">
    <div><h3>Unit Mix Summary · ${esc(state.category||"All")}</h3><div class="invtable"><table class="tra-summary-table"><thead><tr><th>Unit type</th><th>Total</th><th>Available</th><th>Pending</th><th>Signed</th><th>Leased %</th><th>Avg gross</th><th>Avg net</th></tr></thead><tbody>${available("unit_type").map(type=>{const a=base.filter(r=>r.unit_type===type),signed=a.filter(r=>r.lease_status==="Signed").length,avg=key=>{const n=a.map(r=>Number(r[key])).filter(x=>x>0);return n.length?Math.round(n.reduce((x,y)=>x+y,0)/n.length):null};return `<tr><td>${esc(type)}</td><td>${a.length}</td><td>${a.filter(r=>r.lease_status==="Available").length}</td><td>${a.filter(r=>r.lease_status==="Pending").length}</td><td>${signed}</td><td>${(signed/a.length*100).toFixed(1)}%</td><td>${esc(display(avg("gross_rent"),"gross_rent"))}</td><td>${esc(display(avg("net_effective_rent"),"net_effective_rent"))}</td></tr>`}).join("")}</tbody></table></div></div>
    <div><h3>Leasing Status</h3><div class="invtable"><table class="tra-summary-table"><thead><tr><th>Status</th><th>Units</th><th>% Total</th></tr></thead><tbody>${[...new Set(base.map(r=>r.lease_status))].sort(natural.compare).map(status=>{const n=base.filter(r=>r.lease_status===status).length;return `<tr><td>${esc(status)}</td><td>${n}</td><td>${(n/base.length*100).toFixed(1)}%</td></tr>`}).join("")}</tbody></table></div><h3 style="margin-top:16px">Building Breakdown</h3><div class="invtable"><table class="tra-summary-table"><thead><tr><th>Building</th><th>Total</th><th>Available</th><th>Signed</th></tr></thead><tbody>${[...new Set(base.map(r=>r.building))].sort(natural.compare).map(b=>{const a=base.filter(r=>r.building===b);return `<tr><td>${esc(b)}</td><td>${a.length}</td><td>${a.filter(r=>r.lease_status==="Available").length}</td><td>${a.filter(r=>r.lease_status==="Signed").length}</td></tr>`}).join("")}</tbody></table></div></div>
    <div><h3>Average Rent by Unit Type</h3><div class="invtable"><table class="tra-summary-table"><thead><tr><th>Type</th><th>Gross</th><th>Net</th><th>Gross / SF / Yr</th><th>Net / SF / Yr</th></tr></thead><tbody>${available("unit_type").map(type=>{const a=base.filter(r=>r.unit_type===type),avg=key=>{const n=a.map(r=>Number(r[key])).filter(x=>x>0);return n.length?n.reduce((x,y)=>x+y,0)/n.length:null};return `<tr><td>${esc(type)}</td><td>${esc(display(avg("gross_rent"),"gross_rent"))}</td><td>${esc(display(avg("net_effective_rent"),"net_effective_rent"))}</td><td>${avg("gross_rent_psf_year")?.toFixed(2)??"—"}</td><td>${avg("net_rent_psf_year")?.toFixed(2)??"—"}</td></tr>`}).join("")}</tbody></table></div></div></div></div>
    <div class="panel"><div class="invtools"><select data-filter="category" aria-label="Inventory program">${options([['Market','Market'],['Affordable','Affordable'],['','All programs']],state.category)}</select><input class="search" aria-label="Search units" data-filter="search" placeholder="Search unit, layout, building…" value="${esc(state.search)}">${select('building','Buildings',available('building'))}${select('status','Statuses',available('lease_status'))}${select('layout','Layouts',available('unit_type'))}<button data-action="reset">Reset</button></div>
    <div class="sub" data-inventory-summary style="margin:15px 0">${showResults?`${filtered.length} apartments match your filters`:"Search or choose a filter to view apartments"}</div>${showResults?`<div class="invtable"><table aria-label="Master Inventory apartments"><thead><tr>${COLUMNS.map(([key,label])=>`<th aria-sort="${state.sort===key?(state.direction==='asc'?'ascending':'descending'):'none'}"><button data-sort="${key}">${label}</button></th>`).join('')}<th>Details</th></tr></thead><tbody>${filtered.slice(state.page*18,(state.page+1)*18).map(r=>`<tr>${COLUMNS.map(([key])=>`<td>${esc(display(r[key],key))}</td>`).join('')}<td><button class="viewbtn" data-unit="${esc(JSON.stringify([r.building,r.unit_id]))}">View</button></td></tr>`).join('')||'<tr><td colspan="10">No matching apartments</td></tr>'}</tbody></table></div>
    <div class="invpager"><button data-action="previous" ${state.page===0?'disabled':''}>Previous</button><span>Page ${state.page+1} of ${pages}</span><button data-action="next" ${state.page===pages-1?'disabled':''}>Next</button></div>`:""}
    <div class="sectiontitle"><h2>Unit Mix</h2><small>${esc(state.category||'All')} portfolio</small></div><div class="panel">${available('unit_type').map(type=>{const count=base.filter(r=>r.unit_type===type).length;return `<div class="mixitem"><strong>${esc(type)}</strong><div class="track" aria-hidden="true"><div class="fill" style="width:${count/base.length*100}%"></div></div><span>${count}</span></div>`}).join('')}</div>
    <div class="sectiontitle"><h2 id="inventory-detail-title">Apartment Detail</h2></div><div class="panel" data-inventory-detail tabindex="-1" aria-labelledby="inventory-detail-title">${selected?`<div class="detailgrid">${FIELDS.map(key=>`<div class="detailfield"><small>${esc(key.replaceAll('_',' '))}</small><strong>${esc(display(selected[key],key))}</strong></div>`).join('')}</div>`:'Choose “View” on any apartment above.'}</div></div>`;
    root.querySelectorAll('[data-filter]').forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',()=>{state[el.dataset.filter]=el.value;state.page=0;selected=null;render()}));
    root.querySelectorAll('[data-sort]').forEach(el=>el.addEventListener('click',()=>{state.direction=state.sort===el.dataset.sort&&state.direction==='asc'?'desc':'asc';state.sort=el.dataset.sort;state.page=0;render()}));
    root.querySelectorAll('[data-unit]').forEach(el=>el.addEventListener('click',()=>{selected=rows.find(r=>JSON.stringify([r.building,r.unit_id])===el.dataset.unit);render();const detail=root.querySelector('[data-inventory-detail]');detail?.focus({preventScroll:true});detail?.scrollIntoView({behavior:'smooth',block:'nearest'})}));
    root.querySelector('[data-action="previous"]').onclick=()=>{state.page=Math.max(0,state.page-1);render()};
    root.querySelector('[data-action="next"]').onclick=()=>{state.page++;render()};
    root.querySelector('[data-action="reset"]').onclick=()=>{Object.assign(state,{building:'',status:'',layout:'',search:'',sort:'building',direction:'asc',page:0});selected=null;render()};
    root.dataset.inventoryState='ready';
    if(focus){const input=root.querySelector(`[data-filter="${focus}"]`);input?.focus();if(input?.tagName==='INPUT'&&start!=null)input.setSelectionRange(start,start)}
  }
  async function refresh(){
    if(refreshing||stopped)return;refreshing=true;
    try{const next=await loadInventory(client);if(stopped)return;current=next;if(selected)selected=next.rows.find(r=>r.building===selected.building&&r.unit_id===selected.unit_id)||null;render()}
    catch(error){if(!stopped){root.dataset.inventoryState=current?'ready':'error';const notice=root.querySelector('[role="status"]');if(notice)notice.textContent=current?'Inventory refresh failed; showing the previous complete batch.':'Master Inventory could not be loaded. Please try again.';if(!current){const retry=document.createElement('button');retry.type='button';retry.className='viewbtn';retry.textContent='Try again';retry.onclick=()=>{retry.remove();refresh()};root.appendChild(retry)}}}
    finally{refreshing=false}
  }
  await refresh();
  const timer=setInterval(()=>{if(!document.hidden)refresh()},60000);
  return ()=>{stopped=true;clearInterval(timer)};
}
