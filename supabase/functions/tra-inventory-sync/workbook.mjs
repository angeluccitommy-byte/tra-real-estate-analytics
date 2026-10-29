// Inventory-only parser. Does not call or modify the production v5 parser.
export const FIELDS = {
 building:['building','text'],unit_id:['unit_id','text'],floor:['floor','integer'],unit_type:['unit_type','text'],bedrooms:['bedrooms','integer'],bathrooms:['bathrooms','numeric'],square_feet:['square_feet','integer'],program:['inventory_category','text'],status:['lease_status','text'],gross_rent:['gross_rent','numeric'],free_months:['free_months','numeric'],lease_term:['lease_term_months','numeric'],net_effective:['net_effective_rent','numeric'],gross_rent_psf_year:['gross_rent_psf_year','numeric'],net_rent_psf_year:['net_rent_psf_year','numeric'],early_occupancy_start:['early_occupancy_start','date'],lease_start:['lease_start','date'],early_cancellation_option:['early_cancellation_date','date'],lease_expiration:['lease_expiration','date'],actual_occupancy:['actual_occupancy','numeric'],total_free_rent:['total_free_rent','numeric'],gross_monthly:['gross_monthly','numeric'],gross_annualized:['gross_annualized','numeric'],monthly_net_effective:['monthly_net_effective','numeric'],annualized_net_rent:['annualized_net_rent','numeric'],annual_net_psf:['annual_net_psf','numeric'],application_date:['application_date','date'],signed_date:['signed_date','date'],base_gross_rent:['base_gross_rent','numeric'],outdoor_space:['outdoor_space','text'],net_op:['net_op','numeric'],gross_op:['gross_op','numeric'],direction:['direction','text']
};
const knownColumns={building:'A',unit_id:'B',floor:'C',unit_type:'D',bedrooms:'E',bathrooms:'F',square_feet:'G',outdoor_space:'H',direction:'I',program:'J',status:'K',gross_rent:'L',free_months:'M',lease_term:'N',net_effective:'O',gross_rent_psf_year:'Q',net_rent_psf_year:'R',early_occupancy_start:'U',lease_start:'V',early_cancellation_option:'W',lease_expiration:'X',actual_occupancy:'Y',total_free_rent:'Z',gross_monthly:'AA',gross_annualized:'AB',monthly_net_effective:'AC',annualized_net_rent:'AD',annual_net_psf:'AE',application_date:'AF',signed_date:'AG',base_gross_rent:'AH',net_op:'AK',gross_op:'AL'};
const normalize=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const aliases={lease_term:['lease_term_months'],net_effective:['net_effective_rent'],gross_rent_psf_year:['gross_rent_sf_year','gross_rent_per_sf_year','gross_rent_sf_yr'],net_rent_psf_year:['net_rent_sf_year','net_rent_per_sf_year','net_rent_sf_yr'],gross_annualized:['annualized_gross','annualized_gross_rent'],annualized_net_rent:['annualized_net'],annual_net_psf:['annual_net_sf','annual_net_ppsf'],base_gross_rent:['base_gross','base_gross_rent_fallback_no_approved_round'],early_occupancy_start:['early_occupancy','early_occ_start'],monthly_net_effective:['monthly_net_eff'],application_date:['date_of_application'],net_op:['net_o_p'],gross_op:['gross_o_p']};
export function calendarDate(input){
 if(typeof input==='string'){
  const value=input.trim();
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value),us=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if(iso||us){
   const [year,month,day]=iso?[+iso[1],+iso[2],+iso[3]]:[+us[3],+us[1],+us[2]];
   if(year<1900||year>9999)return null;
   const d=new Date(Date.UTC(year,month-1,day));
   return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.toISOString().slice(0,10):null;
  }
  if(!/^\d+(?:\.0+)?$/.test(value))return null;
  input=Number(value);
 }
 if(typeof input!=='number'||!Number.isInteger(input)||input<=0||input===60)return null;
 const time=Date.UTC(1899,11,31)+(input-(input>60?1:0))*86400000;
 const result=new Date(time);
 return Number.isFinite(result.getTime())&&result.getUTCFullYear()<=9999?result.toISOString().slice(0,10):null;
}
function safeValue(sheet,address){
 const cell=sheet[address];
 if(cell?.t==='e')throw Error('Excel source error at '+address);
 if(cell?.f&&cell.v==null)throw Error('Uncalculated source formula at '+address);
 return cell?.v??null;
}
export function extractInventory(XLSX,bytes){
 const book=XLSX.read(bytes,{type:'array',cellDates:false,cellFormula:true,sheetStubs:false});
 return extractInventoryBook(XLSX,book);
}
export function extractInventoryBook(XLSX,book){
 if(book.Workbook?.WBProps?.date1904)throw Error('Inventory requires confirmed Excel 1900 dates');
 const sheetName=name=>{const names=book.SheetNames.filter(n=>n.trim()===name);if(names.length!==1)throw Error('Missing or ambiguous inventory source worksheet');return book.Sheets[names[0]]};
 const sheet=sheetName('Master Inventory'),feed=sheetName('TRA Live Feed');
 const range=XLSX.utils.decode_range(sheet['!ref']||'A1');
 const headers=[];
 for(let row=1;row<=Math.min(range.e.r+1,60);row++)if(safeValue(sheet,`A${row}`)==='Building'&&safeValue(sheet,`B${row}`)==='Unit ID')headers.push(row);
 if(headers.length!==1)throw Error('Missing or ambiguous Master Inventory header');
 const header=headers[0];
 if(safeValue(sheet,`W${header}`)!=='Early Cancellation Option'||safeValue(sheet,`X${header}`)!=='Lease Expiration')throw Error('Master Inventory date column layout changed');
 // Resolve unverified physical positions by their approved semantic headers.
 // Never guess physical letters for fields absent from the supplied v5 reference.
 const columns={...knownColumns};
 for(const field of Object.keys(FIELDS)){
  if(columns[field])continue;
  const accepted=new Set([field,...(aliases[field]||[])]),matches=[];
  for(let col=0;col<=range.e.c;col++){
   const letter=XLSX.utils.encode_col(col);if(letter==='P'||letter==='S')continue;
   if(accepted.has(normalize(safeValue(sheet,letter+header))))matches.push(letter);
  }
  if(matches.length!==1)throw Error('Unverified or ambiguous source header for '+field);
  columns[field]=matches[0];
 }
 if(new Set(Object.values(columns)).size!==33||Object.values(columns).some(c=>c==='P'||c==='S'))throw Error('Invalid inventory field layout');
 const expectedHeaders={building:'Building',unit_id:'Unit ID',floor:'Floor',unit_type:'Unit Type',bedrooms:'Bed',bathrooms:'Bath',square_feet:'SF',outdoor_space:'Outdoor Space',direction:'Direction',program:'Mkt / Aff',status:'Status',gross_rent:'Gross Rent',free_months:'Free Months',lease_term:'Lease Term',net_effective:'Net Effective',gross_rent_psf_year:'Gross Rent $/SF/Yr',net_rent_psf_year:'Net Rent $/SF/Yr',early_occupancy_start:'Early Occ Start',lease_start:'Lease Start Date',early_cancellation_option:'Early Cancellation Option',lease_expiration:'Lease Expiration',actual_occupancy:'Actual Occupancy',total_free_rent:'Total Free Rent',gross_monthly:'Gross Monthly',gross_annualized:'Gross Annualized',monthly_net_effective:'Monthly Net Eff',annualized_net_rent:'Annualized Net Rent',annual_net_psf:'Annual Net PPSF',application_date:'Date of Application',signed_date:'Signed Date',base_gross_rent:'Base Gross Rent (fallback, no Approved round)',net_op:'Net OP',gross_op:'Gross OP'};
 for(const [field,expected] of Object.entries(expectedHeaders)){if(normalize(safeValue(sheet,columns[field]+header))!==normalize(expected))throw Error('Inventory source header changed: '+field)}
 const metrics={};
 const feedRange=XLSX.utils.decode_range(feed['!ref']||'A1');
 for(let row=2;row<=feedRange.e.r+1;row++){
  const name=String(safeValue(feed,`A${row}`)??'').trim();
  if(!['Total Units','Market Units','Affordable Units'].includes(name))continue;
  const source=String(safeValue(feed,`B${row}`)??''),address=String(safeValue(feed,`C${row}`)??'');
  if(!/^[A-Z]+[1-9]\d*$/i.test(address))throw Error('Invalid inventory metric source');
  const value=Number(safeValue(sheetName(source.trim()),address));
  if(!Number.isInteger(value)||value<0||(name in metrics&&metrics[name]!==value))throw Error('Invalid inventory metric');
  metrics[name]=value;
 }
 const rows=[],issues=[],ids=new Set();
 for(let r=header+1;r<=range.e.r+1;r++){
  const building=safeValue(sheet,`A${r}`),id=safeValue(sheet,`B${r}`);
  if((building==null||building==='')&&(id==null||id===''))continue;
  if(!String(building??'').trim()||!String(id??'').trim())throw Error('Incomplete inventory unit identity');
  const unit=String(id).trim();if(ids.has(unit))throw Error('Duplicate inventory unit');ids.add(unit);
  const row={};
  for(const [source,[target,type]] of Object.entries(FIELDS)){
   const address=columns[source]+r;
   let value;
   try{value=safeValue(sheet,address)}catch(error){if(type!=='date')throw error;value='[invalid Excel date cell]'}
   if(value==null||value===''||(typeof value==='string'&&!value.trim())){row[target]=null;continue}
   if(type==='text'){row[target]=String(value).trim();continue}
   if(type==='date'){
    row[target]=calendarDate(value);
    if(row[target]===null)issues.push({building:String(building).trim(),unit_id:unit,field:target,reason:'Invalid date; source correction required',source_value:String(value),workbook_cell:address});
    continue;
   }
   if(typeof value==='string'&&!value.trim()){row[target]=null;continue}
   if((typeof value==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))||!['string','number'].includes(typeof value)||!Number.isFinite(Number(value))||(type==='integer'&&!Number.isInteger(Number(value))))throw Error('Invalid numeric inventory field '+source);
   row[target]=Number(value);
  }
  if(!['Market','Affordable'].includes(row.inventory_category)||!row.lease_status)throw Error('Invalid inventory program or status');
  rows.push(row);
 }
 const market=rows.filter(r=>r.inventory_category==='Market').length,affordable=rows.filter(r=>r.inventory_category==='Affordable').length;
 if(rows.length!==metrics['Total Units']||market!==metrics['Market Units']||affordable!==metrics['Affordable Units'])throw Error('Inventory counts do not match workbook metrics');
 if(rows.length!==517||market!==384||affordable!==133)throw Error('Inventory counts differ from approved baseline');
 return {rows,issues,metrics};
}
