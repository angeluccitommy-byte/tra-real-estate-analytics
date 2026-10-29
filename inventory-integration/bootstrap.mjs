import {mountMasterInventory} from './master-inventory.mjs';
function unavailable(root,message,client){
  // Fixed text only; no source rows or backend errors are embedded in this state.
  root.dataset.inventoryState='unavailable';
  root.innerHTML='<div class="headline"><div><div class="eyebrow">TRA / Portfolio</div><h1 id="inventory-title">Master Inventory</h1><p>Explore authorized Market and Affordable inventory.</p></div></div><div class="notice" role="status"></div><button type="button" class="viewbtn" data-inventory-retry>Try again</button>';
  root.querySelector('[role="status"]').textContent=message;
  root.querySelector('[data-inventory-retry]').onclick=()=>mountValidatedInventory(client,root);
}
export async function mountValidatedInventory(client,root){
  if(!root)return {mounted:false};
  root.dataset.inventoryState='loading';
  let result;
  try{result=await client.rpc('tra_inventory_ready')}catch{
    unavailable(root,'Master Inventory could not be reached. Please try again.',client);
    return {mounted:false};
  }
  const {data,error}=result;
  if(error||data!==true){
    unavailable(root,'Master Inventory has not been published for this account yet. Your other TRA reports remain available.',client);
    return {mounted:false};
  }
  const dispose=await mountMasterInventory(client,root);
  return {mounted:true,dispose};
}
