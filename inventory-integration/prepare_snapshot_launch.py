"""Prepare a private, verified snapshot RPC payload. No network or database writes."""
import argparse
import json
from pathlib import Path
from prepare_inventory import json_exact
from validate_latest_export import validate

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path');parser.add_argument('validation_report');parser.add_argument('--output',required=True)
    args=parser.parse_args()
    rows,report=validate(args.csv_path,args.validation_report)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'snapshot-rpc-payload.json').write_text(json_exact({'p_units':rows,'p_issues':report['date_correction_flags'],'p_source_sha256':report['source_sha256']})+'\n')
    (out/'inventory-candidate.json').write_text(json_exact(rows)+'\n')
    (out/'inventory-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'records':report['records'],'categories':report['categories'],'fields_per_record':len(rows[0]),'source_date_flags':len(report['date_correction_flags']),'network_writes':False},indent=2))
