// Wire this only after deployment; the database also guards the first activation.
import {mountMasterInventory} from './master-inventory.mjs';
export async function mountValidatedInventory(client,root){
  if(!root)return {mounted:false};
  let result;
  try{result=await client.rpc('tra_inventory_ready')}catch{return {mounted:false}}
  const {data,error}=result;
  if(error||data!==true)return {mounted:false}; // Existing explicitly labeled snapshot stays intact.
  const dispose=await mountMasterInventory(client,root);
  return {mounted:true,dispose};
}
