"""Deterministic fictional fixtures. Never reads a production workbook/export."""
import csv
from functools import lru_cache
import json
from pathlib import Path
import tempfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from prepare_inventory import FIELDS
from validate_inventory import excel_date
from validate_latest_export import HEADERS

@lru_cache(maxsize=1)
def paths():
    root=Path(tempfile.gettempdir())/'tra-inventory-synthetic-fixtures'
    root.mkdir(exist_ok=True)
    baseline=[];latest=[]
    for index in range(517):
        row={field:'' for field in FIELDS}
        for field,(target,kind) in FIELDS.items():
            if kind in ['integer','numeric']:row[field]=str(index+1)
            elif kind=='date':row[field]=str(50000+index%30)
        row.update(building='TEST-BUILDING-A' if index<260 else 'TEST-BUILDING-B',unit_id=f'TEST-{index+1:04}',floor=str(index%20+1),unit_type='Fixture 1BR' if index%2 else 'Fixture Studio',bedrooms=str(index%3),bathrooms='1',square_feet=str(500+index),program='Market' if index<384 else 'Affordable',status='Available' if index%4==0 else 'Signed',gross_rent=str(1000+index),free_months='0',gross_rent_psf_year='12.345678901234567',outdoor_space='Synthetic balcony' if index%7==0 else '',direction='Synthetic north' if index%3==0 else '')
        # The three error cases and coordinates below are wholly fictional.
        old={key:value for key,value in row.items() if key not in ['outdoor_space','direction']}
        old.update(source='synthetic-source',renewal='synthetic-renewal')
        if index==0:old['lease_start']='invalid-date-a'
        if index==1:old['lease_expiration']='invalid-date-b'
        if index==2:old['lease_expiration']='1/2/999'
        baseline.append(old)
        current={header:(excel_date(row[field],'1900') if FIELDS[field][1]=='date' and row[field] else row[field]) for header,field in HEADERS.items()}
        if index==2:current['Lease Expiration']=''
        latest.append(current)
    for name,rows in [('baseline.csv',baseline),('latest.csv',latest)]:
        with (root/name).open('w',newline='',encoding='utf-8') as stream:
            writer=csv.DictWriter(stream,fieldnames=rows[0]);writer.writeheader();writer.writerows(rows)
    report={'source_workbook':'SYNTHETIC_ONLY.xlsx','total_units':517,'classification_counts':{'Market':384,'Affordable':133},'date_checks':[
        {'unit':'TEST-0001','cell':'V2','status':'valid','date':latest[0]['Lease Start Date']},
        {'unit':'TEST-0002','cell':'X3','status':'valid','date':latest[1]['Lease Expiration']},
        {'unit':'TEST-0003','cell':'X4','status':'invalid_source_text','source_value':'1/2/999','exported_value':None}]}
    (root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    return root/'baseline.csv',root/'latest.csv',root/'report.json'
