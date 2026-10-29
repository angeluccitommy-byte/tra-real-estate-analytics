import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarDate,extractInventoryBook} from '../../supabase/functions/tra-inventory-sync/workbook.mjs';
const fresh=()=>JSON.parse(readFileSync('/tmp/tra-inventory-synthetic-book.json'));
const utils={encode_col(index){let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s},decode_range(ref){const end=ref.split(':').at(-1),match=/([A-Z]+)(\d+)/.exec(end);let c=0;for(const letter of match[1])c=c*26+letter.charCodeAt(0)-64;return {e:{r:+match[2]-1,c:c-1}}}};
test('33-field workbook extraction retains counts, accepted flag and privacy',()=>{
 const result=extractInventoryBook({utils},fresh());
 const expected=JSON.parse(readFileSync('/tmp/tra-inventory-dry-run/inventory-candidate.json'));
 assert.deepEqual(result.rows,expected);assert.equal(result.issues.length,1);
 assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
 assert.equal(result.rows.filter(r=>r.inventory_category==='Market').length,384);
});
test('synthetic corrected date cells clear flags without dropping any units',()=>{
 const book=fresh(),sheet=book.Sheets['Master Inventory'];
 // Synthetic regression input only; these are NOT the user's corrected dates.
 for(const [address,cell] of Object.entries(sheet))if(['1/2/999'].includes(cell.v))cell.v=61;
 const result=extractInventoryBook({utils},book);
 assert.equal(result.rows.length,517);assert.equal(result.issues.length,0);
 assert.equal(result.rows.filter(r=>r.inventory_category==='Affordable').length,133);
});
test('date calendar validation, changed epoch, and incomplete feed fail safely',()=>{
 assert.equal(calendarDate(59),'1900-02-28');assert.equal(calendarDate(60),null);assert.equal(calendarDate(61),'1900-03-01');
 assert.equal(calendarDate('invalid-date'),null);assert.equal(calendarDate('2027-02-30'),null);assert.equal(calendarDate(16.5),null);
 let book=fresh();book.Workbook.WBProps.date1904=true;assert.throws(()=>extractInventoryBook({utils},book),/1900/);
 book=fresh();book.Sheets['Inventory Totals'].A2.v=516;assert.throws(()=>extractInventoryBook({utils},book),/counts/);
});
