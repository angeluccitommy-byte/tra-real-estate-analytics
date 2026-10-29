"""Validate a manual live import and record the gate. NEVER activates the schedule."""
import argparse
from decimal import Decimal
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from prepare_inventory import FIELDS, json_exact
from validate_latest_export import validate

PROJECT='https://bluavamwhplpyuzeppfc.supabase.co'
TARGET_FIELDS=[target for target,kind in FIELDS.values()]
KINDS={target:kind for target,kind in FIELDS.values()}


def request(path, key, token=None, payload=None):
    headers={'apikey':key,'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(PROJECT+path,headers=headers,data=None if payload is None else json_exact(payload).encode())
    try:
        with urllib.request.urlopen(req,timeout=45) as response:
            body=response.read()
            return response.status,json.loads(body,parse_float=Decimal) if body else None
    except urllib.error.HTTPError as error:
        return error.code,None # Never print bodies/headers that could contain sensitive values.


def required(path,key,token=None,payload=None):
    status,data=request(path,key,token,payload)
    if status not in [200,201,204]:raise ValueError('Live validation request failed: HTTP '+str(status))
    return data


def verify_rows(expected,actual):
    key=lambda row:(row['building'],row['unit_id'])
    if len(actual)!=517 or len({key(r) for r in actual})!=517:raise ValueError('Incomplete or duplicate live inventory')
    exp={key(r):r for r in expected};got={key(r):r for r in actual}
    if set(exp)!=set(got):raise ValueError('Live unit keys differ from the accepted export')
    for unit,row in exp.items():
        if set(got[unit])!=set(TARGET_FIELDS):raise ValueError('Unexpected live fields')
        for field,value in row.items():
            live=got[unit][field]
            if KINDS[field]=='numeric' and value is not None and live is not None:
                # XLSM/SheetJS numeric cells are IEEE-754 doubles. No arbitrary tolerance.
                if not math.isfinite(float(live)) or float(value)!=float(live):raise ValueError('Numeric live/source mismatch in '+field)
            elif value!=live:raise ValueError('Live/source mismatch in '+field)


def validate_remote(expected,report,public_key,approved,unapproved):
    good=required('/auth/v1/user',public_key,approved)
    bad=required('/auth/v1/user',public_key,unapproved)
    if not good.get('id') or not bad.get('id') or good['id']==bad['id']:raise ValueError('Two distinct authenticated reader identities are required')
    batch=required('/rest/v1/tra_inventory_batches?active=eq.true&select=id,synced_at,total_units,market_units,affordable_units,date_issues',public_key,approved)
    if not isinstance(batch,list) or len(batch)!=1:raise ValueError('No single authorized active batch')
    batch=batch[0]
    if [batch['total_units'],batch['market_units'],batch['affordable_units']]!=[517,384,133]:raise ValueError('Unexpected live counts')
    rows=[]
    for offset in range(0,517,200):
        query=urllib.parse.urlencode({'batch_id':'eq.'+batch['id'],'select':','.join(TARGET_FIELDS),'order':'building.asc,unit_id.asc','offset':offset,'limit':200})
        page=required('/rest/v1/tra_inventory_units?'+query,public_key,approved)
        if not isinstance(page,list) or not page:raise ValueError('Incomplete live page')
        rows+=page
    verify_rows(expected,rows)
    for token in [None,unapproved]:
        for table in ['tra_inventory_units','tra_inventory_batches']:
            status,data=request('/rest/v1/'+table+'?select=*&limit=1',public_key,token)
            if not (status in [401,403] or status==200 and data==[]):raise ValueError('Unauthorized inventory read was not denied')
    issue_key=lambda i:(i.get('unit_id'),i.get('field'),i.get('workbook_cell'),i.get('source_value'))
    if sorted(map(issue_key,batch['date_issues']))!=sorted(map(issue_key,report['date_correction_flags'])):raise ValueError('Live date flags disagree with accepted report')
    return rows,batch


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path');parser.add_argument('source_report');parser.add_argument('--output',required=True)
    args=parser.parse_args()
    expected,source=validate(args.csv_path,args.source_report)
    root=Path(__file__).resolve().parents[1]
    # Public browser key is reused, never replace the project configuration.
    key=re.search(r"'(sb_publishable_[^']+)'",(root/'tra-secure-data.js').read_text())[1]
    rows,batch=validate_remote(expected,source,key,os.environ['TRA_INVENTORY_APPROVED_READER_TOKEN'],os.environ['TRA_INVENTORY_UNAPPROVED_READER_TOKEN'])
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'inventory-candidate.json';path.write_text(json_exact(rows))
        metadata=Path(temp)/'batch.json';metadata.write_text(json_exact(batch))
        omitted={'TRA_INVENTORY_SERVICE_ROLE_KEY','TRA_INVENTORY_APPROVED_READER_TOKEN','TRA_INVENTORY_UNAPPROVED_READER_TOKEN','SUPABASE_ACCESS_TOKEN','SUPABASE_DB_URL','DATABASE_URL'}
        process_env={k:v for k,v in os.environ.items() if k not in omitted}
        process_env.update(TRA_INVENTORY_CANDIDATE=str(path),TRA_INVENTORY_BATCH_METADATA=str(metadata))
        # Controlled command, no shell, no credential values on the command line.
        result=subprocess.run(['node','inventory-integration/tests/browser.cjs'],cwd=root,env=process_env,capture_output=True,text=True)
        if result.returncode!=0:raise ValueError('Live-data browser smoke check failed; gate not recorded')
    checks={'approved_reader_verified':True,'anonymous_denied':True,'unapproved_reader_denied':True,'dashboard_smoke_passed':True,'source_sha256':source['source_sha256']}
    service=os.environ['TRA_INVENTORY_SERVICE_ROLE_KEY']
    required('/rest/v1/rpc/tra_confirm_inventory_manual_import',service,service,{'p_batch':batch['id'],'p_expected_units':rows,'p_expected_issues':source['date_correction_flags'],'p_checks':checks})
    out={'passed':True,'batch_id':batch['id'],'records':517,'market':384,'affordable':133,'date_flags':len(batch['date_issues']),'checks':checks,'numeric_comparison':'exact IEEE-754 equivalence for numeric XLSM cells; integer/date/text exact','schedule_activated':False}
    Path(args.output).write_text(json.dumps(out,indent=2)+'\n')
    print('Manual import validation passed and recorded. Schedule remains disabled.')

if __name__=='__main__':
    try:main()
    except Exception as error:
        if isinstance(error,ValueError):raise SystemExit(str(error)) from None
        raise SystemExit('Manual validation failed ('+type(error).__name__+'); schedule remains disabled') from None
