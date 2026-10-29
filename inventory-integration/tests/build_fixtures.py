"""Build synthetic workbook-cell fixtures; not a production workbook export."""
import csv
import json
import os
from pathlib import Path

import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from validate_latest_export import HEADERS
from synthetic import paths
from validate_latest_export import validate
from prepare_inventory import json_exact
_,source,report_path=paths()
rows=[{field:row[header] for header,field in HEADERS.items()} for row in csv.DictReader(source.open(encoding='utf-8-sig',newline=''))]
for row in rows:
    if row['unit_id']=='TEST-0003':row['lease_expiration']='1/2/999'
header_labels={field:header for header,field in HEADERS.items()}
known={'building':'A','unit_id':'B','floor':'C','unit_type':'D','bedrooms':'E','bathrooms':'F','square_feet':'G','program':'J','status':'K','gross_rent':'L','lease_start':'V','early_cancellation_option':'W','lease_expiration':'X','actual_occupancy':'Y'}
def column(n):
    s=''
    while n:
        n,r=divmod(n-1,26)
        s=chr(65+r)+s
    return s
letters=(column(n) for n in range(1,100) if column(n) not in set(known.values())|{'P','S'})
columns={field:known[field] if field in known else next(letters) for field in rows[0]}
sheet={'!ref':f'A1:AZ{len(rows)+1}','P1':{'v':'Notes'},'S1':{'v':'Tenant Name'},'P2':{'v':'PRIVATE_SENTINEL'},'S2':{'v':'PRIVATE_SENTINEL'}}
for field,letter in columns.items():
    sheet[letter+'1']={'v':header_labels[field]}
for i,row in enumerate(rows,2):
    for field,letter in columns.items():
        if row[field]!='':sheet[letter+str(i)]={'v':row[field]}
book={'SheetNames':['Master Inventory','TRA Live Feed','Inventory Totals'],'Sheets':{'Master Inventory':sheet,'TRA Live Feed':{'!ref':'A1:C4'},'Inventory Totals':{}},'Workbook':{'WBProps':{'date1904':False}}}
for i,(name,value) in enumerate([('Total Units',len(rows)),('Market Units',sum(r['program']=='Market' for r in rows)),('Affordable Units',sum(r['program']=='Affordable' for r in rows))],2):
    feed=book['Sheets']['TRA Live Feed']
    feed['A'+str(i)]={'v':name}
    feed['B'+str(i)]={'v':'Inventory Totals'}
    feed['C'+str(i)]={'v':'A'+str(i)}
    book['Sheets']['Inventory Totals']['A'+str(i)]={'v':value}
Path('/tmp/tra-inventory-synthetic-book.json').write_text(json.dumps(book))

normalized,report=validate(source,report_path)
output=Path('/tmp/tra-inventory-dry-run');output.mkdir(exist_ok=True)
(output/'inventory-candidate.json').write_text(json_exact(normalized)+'\n')
(output/'inventory-validation.json').write_text(json.dumps(report,indent=2)+'\n')
