// NEW function only. Never deploy this file over tra-onedrive-sync.
import postgres from 'npm:postgres@3.4.7';
import * as XLSX from './vendor/xlsx.mjs';
import { extractInventory } from './workbook.mjs';

const databaseURL = Deno.env.get('SUPABASE_DB_URL');
const pool = databaseURL ? postgres(databaseURL, {max:2,prepare:false,idle_timeout:10,connect_timeout:15}) : null;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function equal(a:string,b:string){
 const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
 const [x,y]=await Promise.all([digest(a),digest(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
async function metadata(graph:string,token:string){
 const r=await fetch(graph+'?$select=id,eTag,lastModifiedDateTime,size',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('source_metadata');
 const body=await r.json();
 if(!body.eTag||!body.lastModifiedDateTime||!Number.isFinite(Date.parse(body.lastModifiedDateTime))||!(body.size>0&&body.size<20000000))throw Error('source_metadata');
 return body;
}
async function download(graph:string,token:string){
 let url=graph+'/content',headers:Record<string,string>={Authorization:'Bearer '+token};
 for(let attempt=0;attempt<5;attempt++){
  const response=await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(60000)});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');if(!location)throw Error('workbook_download');
   const next=new URL(location,url);if(next.protocol!=='https:')throw Error('workbook_download');
   url=next.href;headers={};continue; // Never forward OAuth credentials to download hosts.
  }
  if(!response.ok)throw Error('workbook_download');
  const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>=20000000)throw Error('workbook_download');return bytes;
 }
 throw Error('workbook_download');
}
Deno.serve(async request=>{
 if(request.method!=='POST')return reply({error:'POST required'},405);
 if(!pool)return reply({error:'Inventory database binding is unavailable'},503);
 let sql:any,locked=false,authorized=false,phase='configuration';
 try{
  sql=await pool.reserve();
  const [hook]=await sql`select decrypted_secret from vault.decrypted_secrets where name='tra_inventory_invocation'`;
  if(!hook||!await equal(request.headers.get('x-inventory-invocation')||'',hook.decrypted_secret))return reply({error:'Unauthorized'},401);
  authorized=true;
  const [lock]=await sql`select pg_try_advisory_lock(20261028,518) as acquired`;locked=lock.acquired;
  if(!locked)return reply({status:'already_running'},202);
  const [state]=await sql`select * from tra_inventory_private.runtime where singleton`;
  if(!state?.enabled)return reply({status:'disabled'},409);
  // Read identifiers only. Never update production state or read its refresh token.
  const [config]=await sql`select tenant_id,client_id,drive_id,item_id from tra_sync.connection where singleton`;
  if(!config?.tenant_id||!config?.client_id||!config?.drive_id||!config?.item_id)throw Error('configuration');
  const [secret]=await sql`select id,decrypted_secret from vault.decrypted_secrets where name='tra_inventory_refresh_token'`;
  if(!secret)throw Error('inventory_authorization');
  phase='microsoft_authorization';
  const tokenResponse=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant_id)}/oauth2/v2.0/token`,{method:'POST',body:new URLSearchParams({client_id:config.client_id,grant_type:'refresh_token',refresh_token:secret.decrypted_secret,scope:'https://graph.microsoft.com/Files.Read offline_access'}),signal:AbortSignal.timeout(30000)});
  const token=await tokenResponse.json();
  if(!tokenResponse.ok||!token.access_token)throw Error(phase);
  // Rotate only the separate inventory grant. Never touch tra_onedrive_refresh_token.
  if(token.refresh_token)await sql`select vault.update_secret(${secret.id}::uuid,${token.refresh_token}::text)`;
  const graph='https://graph.microsoft.com/v1.0/drives/'+encodeURIComponent(config.drive_id)+'/items/'+encodeURIComponent(config.item_id);
  phase='source_metadata';const before=await metadata(graph,token.access_token);
  if(before.eTag===state.source_etag){await sql`update tra_inventory_private.runtime set last_checked_at=now(),last_error=null where singleton`;return reply({status:'unchanged',last_success_at:state.last_success_at})}
  if(state.source_modified_at&&Date.parse(before.lastModifiedDateTime)<new Date(state.source_modified_at).getTime())throw Error('source_regression');
  phase='workbook_download';const bytes=await download(graph,token.access_token);
  phase='workbook_validation';const payload=extractInventory(XLSX,bytes);
  const after=await metadata(graph,token.access_token);if(after.eTag!==before.eTag)throw Error('source_changed');
  phase='database_import';
  await sql`begin`;
  try{
   const [published]=await sql`select public.tra_publish_inventory(${sql.json(payload.rows)}::jsonb,${sql.json(payload.issues)}::jsonb,${before.eTag}::text,517,384,133) as batch_id`;
   await sql`update tra_inventory_private.runtime set source_etag=${before.eTag},source_modified_at=${before.lastModifiedDateTime}::timestamptz,last_checked_at=now(),last_success_at=now(),last_error=null where singleton`;
   await sql`commit`;
   return reply({status:'synced',batch_id:published.batch_id,total:517,market:384,affordable:133,date_corrections:payload.issues.length});
  }catch(error){await sql`rollback`;throw error}
 }catch{
  if(authorized&&sql){try{await sql`update tra_inventory_private.runtime set last_checked_at=now(),last_error=${'Inventory sync failed during '+phase} where singleton`}catch{}}
  return reply({error:authorized?'Inventory sync failed during '+phase:'Inventory sync unavailable'},503);
 }finally{
  if(locked){try{await sql`select pg_advisory_unlock(20261028,518)`}catch{}}
  if(sql)sql.release();
 }
});
