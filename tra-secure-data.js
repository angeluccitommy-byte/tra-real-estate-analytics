// TRA authenticated metrics reader. Access is enforced by Supabase RLS,
// not by this JavaScript module or the GitHub Pages login screen.
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const supabase=createClient(
  'https://bluavamwhplpyuzep pfc.supabase.co'.replace(' ',''),
  'sb_publishable_P20i7A0SMagYEuD3pvGkrw_LIYb5okv'
);
let metricsPromise;
export function getAuthenticatedMetrics(){
  if(!metricsPromise)metricsPromise=readAuthenticatedMetrics().catch(error=>{metricsPromise=null;throw error});
  return metricsPromise;
}
async function readAuthenticatedMetrics(){
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)throw new Error('TRA sign-in required');
  const {data,error}=await supabase.from('tra_metrics').select('metric,value');
  if(error)throw new Error('TRA data access denied: '+error.message);
  if(!data?.length)throw new Error('No authorized TRA metrics were returned');
  return Object.fromEntries(data.filter(row=>row.metric).map(row=>[row.metric,row.value??'']));
}

export async function getExpirationRecords(reportType){
  if(!['leases','riders'].includes(reportType))throw new Error('Unknown report');
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)throw new Error('TRA sign-in required');
  const {data,error}=await supabase.from('tra_expiration_records').select('building,unit_id,floor,unit_type,bedrooms,bathrooms,square_feet,tenant_name,lease_status,gross_rent,lease_start,event_date,notes,synced_at').eq('report_type',reportType).order('event_date',{ascending:true});
  if(error)throw new Error('Expiration report access denied: '+error.message);
  setTimeout(()=>stampExpiration(reportType,data||[]),0);
  return data||[];
}

export async function getMetricsRevision(){
  const {data,error}=await supabase.from('tra_metrics').select('updated_at').order('updated_at',{ascending:false,nullsFirst:false}).limit(1);
  if(error)throw error;
  return data?.[0]?.updated_at||null;
}

function syncLabel(timestamp){
  return timestamp?new Date(timestamp).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' ET':'Latest import';
}
function stampExpiration(type,rows){
  const view=document.getElementById(type);if(!view)return;
  const latest=rows.map(row=>row.synced_at).filter(Boolean).sort().at(-1);
  const label='Automatic PMG OneDrive sync · Last synced '+syncLabel(latest);
  const notice=view.querySelector('.notice');if(notice)notice.textContent=label;
  const sub=view.querySelector('.panel>.sub');
  if(sub)sub.textContent=sub.textContent.replace(/Data last imported from Excel, not automatically synced from OneDrive\./,'Saved workbook changes sync every 5 minutes.');
}
function replaceTable(table,source){
  if(!table||!source)return;
  const head=table.tHead||table.createTHead();head.replaceChildren();
  const header=head.insertRow();
  for(const value of source.header){const cell=document.createElement('th');cell.textContent=value;header.appendChild(cell)}
  const body=table.tBodies[0]||table.createTBody();body.replaceChildren();
  for(const values of source.rows){const row=body.insertRow();if(/total/i.test(String(values[0])))row.className='totalrow';for(const value of values)row.insertCell().textContent=value??''}
}
async function connectReportDetails(){
  const [{data:snapshots,error},metrics]=await Promise.all([
    supabase.from('tra_report_snapshots').select('report_type,payload,synced_at'),
    getAuthenticatedMetrics()
  ]);
  if(error)throw error;
  if(snapshots?.length!==3)throw Error('The three workbook report snapshots are not available');
  // Existing metric renderers share metricsPromise and finish before this timer.
  await new Promise(resolve=>setTimeout(resolve,0));
  for(const snapshot of snapshots){
    const root=document.getElementById(snapshot.report_type);if(!root)continue;
    if(snapshot.report_type==='daily'){
      const details=[...root.querySelectorAll('#dailyDetails .detail')];
      snapshot.payload.forEach((tables,index)=>tables.forEach((source,t)=>replaceTable(details[index]?.querySelectorAll('table')[t],source)));
      const button=details[3]?.querySelector('button');
      if(button?.firstChild)button.firstChild.textContent=(metrics['Monthly Report Period']||'Current month')+' · '+(metrics['Monthly Signed Leases']||'0')+' Signed Deals & Monthly Totals ';
    }else{
      for(const section of root.querySelectorAll('.tra-report-section')){
        const title=section.querySelector('h2')?.textContent.trim();
        if(snapshot.payload[title])replaceTable(section.querySelector('table'),snapshot.payload[title]);
      }
    }
    const label='Automatic PMG OneDrive sync · Last synced '+syncLabel(snapshot.synced_at)+' · Saved workbook changes sync every 5 minutes.';
    const notice=root.querySelector('.notice');if(notice)notice.textContent=label;
    root.querySelectorAll('.tra-weekly-source').forEach(node=>node.textContent=label);
    const chip=root.querySelector('.headline .chip');
    if(chip)chip.textContent=snapshot.report_type==='weekly'?metrics['Weekly Report Period']:snapshot.report_type==='monthly'?metrics['Monthly Report Period']:metrics['Report Date'];
  }
  const footer=document.querySelector('.sidefooter');
  if(footer)footer.replaceChildren(document.createTextNode('Society Brooklyn'),document.createElement('br'),document.createTextNode('Market-rate leasing'),document.createElement('br'),document.createElement('br'),document.createTextNode('Automatic OneDrive sync'));
}

async function startAutomaticRefresh(){
  try{
    await connectReportDetails();
    let revision=await getMetricsRevision();
    const key='tra-automatic-view';
    try{
      const state=JSON.parse(sessionStorage.getItem(key)||'null');sessionStorage.removeItem(key);
      if(state&&document.getElementById(state.view)){
        window.setView(state.view);
        state.open?.forEach(index=>document.querySelectorAll('#'+state.view+' .detail')[index]?.classList.add('open'));
        window.scrollTo(0,state.scroll||0);
      }
    }catch{/* An unavailable session store does not prevent report loading. */}
    let lastInput=0,checking=false;
    for(const event of ['keydown','pointerdown'])document.addEventListener(event,()=>{lastInput=Date.now()},{passive:true});
    const check=async()=>{
      if(checking||document.hidden)return;
      checking=true;
      try{
        const next=await getMetricsRevision();
        if(!next||next===revision)return;
        const view=document.querySelector('.side nav button.active')?.dataset.view;
        if(!['daily','weekly','monthly','leases','riders'].includes(view)||Date.now()-lastInput<5000)return;
        const open=[...document.querySelectorAll('#'+view+' .detail')].flatMap((node,index)=>node.classList.contains('open')?[index]:[]);
        try{sessionStorage.setItem(key,JSON.stringify({view,open,scroll:window.scrollY}))}catch{}
        location.reload();
      }catch(error){console.warn('TRA refresh check unavailable',error.message)}finally{checking=false}
    };
    setInterval(check,60000);
    document.addEventListener('visibilitychange',check);
  }catch(error){console.warn('TRA automatic report details unavailable',error.message)}
}
if(typeof document!=='undefined'){
  if(document.readyState==='complete')startAutomaticRefresh();
  else window.addEventListener('load',startAutomaticRefresh,{once:true});
}

