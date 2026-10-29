// Entry point for the inventory view inside the existing TRA page.
// Uses exactly the same project client and login session as the reports.
import {traSupabase} from '../tra-secure-data.js';
import {mountValidatedInventory} from './bootstrap.mjs';
const root=document.getElementById('inventory');
if(root)await mountValidatedInventory(traSupabase,root);
