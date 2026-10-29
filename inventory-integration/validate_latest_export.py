"""Audit the latest privacy-safe header format without changing the live schema."""
import argparse
from collections import Counter
import csv
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import tempfile
from prepare_inventory import FIELDS, json_exact, prepare

HEADERS = {
    'Building':'building','Unit ID':'unit_id','Floor':'floor','Unit Type':'unit_type',
    'Bed':'bedrooms','Bath':'bathrooms','SF':'square_feet',
    'Mkt / Aff':'program','Status':'status','Gross Rent':'gross_rent',
    'Free Months':'free_months','Lease Term':'lease_term','Net Effective':'net_effective',
    'Gross Rent $/SF/Yr':'gross_rent_psf_year','Net Rent $/SF/Yr':'net_rent_psf_year',
    'Early Occ Start':'early_occupancy_start','Lease Start Date':'lease_start',
    'Early Cancellation Option':'early_cancellation_option','Lease Expiration':'lease_expiration',
    'Actual Occupancy':'actual_occupancy','Total Free Rent':'total_free_rent',
    'Gross Monthly':'gross_monthly','Gross Annualized':'gross_annualized',
    'Monthly Net Eff':'monthly_net_effective','Annualized Net Rent':'annualized_net_rent',
    'Annual Net PPSF':'annual_net_psf','Date of Application':'application_date',
    'Signed Date':'signed_date','Base Gross Rent (fallback, no Approved round)':'base_gross_rent',
    'Net OP':'net_op','Gross OP':'gross_op',
    'Outdoor Space':'outdoor_space','Direction':'direction',
}
EXTRA_HEADERS = set()
DATE_COLUMNS = {'U':'early_occupancy_start','V':'lease_start','W':'early_cancellation_date','X':'lease_expiration','AF':'application_date','AG':'signed_date'}

def to_serial(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return value
    try:
        day = date.fromisoformat(value)
    except ValueError:
        return value
    if day < date(1900,1,1):
        return value
    return str((day-date(1899,12,31)).days + (day >= date(1900,3,1)))

def validate(csv_path, supplied_path):
    with open(csv_path, encoding='utf-8-sig', newline='') as stream:
        reader=csv.DictReader(stream)
        if set(reader.fieldnames or []) != set(HEADERS)|EXTRA_HEADERS or len(reader.fieldnames)!=33:
            raise ValueError('Unexpected latest export headers; review schema before processing')
        original=list(reader)
    supplied=json.loads(Path(supplied_path).read_text())
    with tempfile.TemporaryDirectory() as tmp:
        adapted=Path(tmp)/'approved-fields.csv'
        with adapted.open('w',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=FIELDS)
            writer.writeheader()
            for source in original:
                if None in source or any(value is None for value in source.values()):
                    raise ValueError('Malformed CSV row')
                row={name:'' for name in FIELDS}
                for header,field in HEADERS.items():
                    value=source[header].strip()
                    row[field]=to_serial(value) if FIELDS[field][1]=='date' else value
                writer.writerow(row)
        rows, report=prepare(adapted)
    if report['records']!=517 or report['categories']!={'Market':384,'Affordable':133}:
        raise ValueError('Latest inventory failed approved completeness counts')
    if supplied.get('total_units')!=report['records'] or supplied.get('classification_counts')!=report['categories']:
        raise ValueError('Supplied report count disagreement')
    dates=[]
    checks=supplied.get('date_checks')
    if not isinstance(checks,list):raise ValueError('Source report date checks are required')
    seen=set()
    for check in checks:
        unit=check.get('unit');cell=check.get('cell')
        if not isinstance(unit,str) or not unit.strip() or not isinstance(cell,str):raise ValueError('Invalid source date check')
        address=re.fullmatch(r'([A-Z]+)[1-9]\d*',cell)
        if not address or address[1] not in DATE_COLUMNS:raise ValueError('Unapproved source date column')
        field=DATE_COLUMNS[address[1]]
        if (unit,cell) in seen:raise ValueError('Duplicate source date check')
        seen.add((unit,cell))
        matches=[r for r in rows if r['unit_id']==unit]
        if len(matches)!=1:
            raise ValueError('Missing or ambiguous source-correction unit')
        value=matches[0][field]
        if check.get('status')=='valid':
            if value is None or value!=check.get('date'):
                raise ValueError('Supplied valid date disagrees with CSV')
            dates.append({'unit_id':unit,'workbook_cell':cell,'field':field,'status':'verified_valid_in_csv','date':value})
        elif check.get('status')=='invalid_source_text':
            if value is not None or check.get('exported_value') is not None:
                raise ValueError('Supplied invalid source date disagrees with CSV')
            issue={'building':matches[0]['building'],'unit_id':unit,'field':field,'workbook_cell':cell,'reason':'Source validation report flags malformed text; CSV is blank, not corrected'}
            raw=check.get('source_value','')
            if isinstance(raw,str) and re.fullmatch(r'\d{1,2}/\d{1,2}/\d{1,4}',raw):
                issue['source_value']=raw
            report['date_correction_flags'].append(issue)
            dates.append({'unit_id':unit,'workbook_cell':cell,'field':field,'status':'unresolved_source_date_exported_null','date':None})
        else:
            raise ValueError('Unsupported date-check status')
    report.update({
        'source_sha256':hashlib.sha256(Path(csv_path).read_bytes()).hexdigest(),
        'attached_report_sha256':hashlib.sha256(Path(supplied_path).read_bytes()).hexdigest(),
        'date_checks':dates,
        'csv_report_counts_agree':True,
        'schema_compatible_without_review':True,
        'approved_fields_absent':[],
        'unmapped_export_headers':sorted(EXTRA_HEADERS),
        'candidate_note':'Accepted latest 33-field contract including Outdoor Space and Direction; Source/Renewal are outside this new schema. No publication.',
        'source_workbook_independently_read':False,
        'date_issue_provenance':'Invalid source text flags are attested by the supplied report; their CSV fields are blank',
    })
    return rows,report

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path');parser.add_argument('supplied_report');parser.add_argument('output')
    args=parser.parse_args();rows,report=validate(args.csv_path,args.supplied_report)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'inventory-candidate.json').write_text(json_exact(rows)+'\n')
    (out/'inventory-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k in ['records','unique_units','categories','market_kpis','date_checks','approved_fields_absent','unmapped_export_headers']},indent=2))
