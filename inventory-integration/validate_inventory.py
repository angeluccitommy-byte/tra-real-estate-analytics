"""Read-only validation of the privacy-safe Master Inventory CSV."""
import argparse
import csv
from collections import Counter
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import json

TEXT = {'building', 'unit_id', 'unit_type', 'program', 'status', 'outdoor_space', 'direction'}
DATES = {'early_occupancy_start', 'lease_start', 'early_cancellation_option', 'lease_expiration', 'application_date', 'signed_date'}
INTEGER = {'floor', 'bedrooms', 'square_feet'}

def excel_date(value, epoch):
    serial = Decimal(value)
    if not serial.is_finite() or serial != serial.to_integral_value():
        raise ValueError('Expected a finite whole-day Excel serial')
    n = int(serial)
    if epoch == '1900':
        if n <= 0 or n == 60:
            raise ValueError('Invalid calendar date in Excel 1900 system')
        return (date(1899, 12, 31) + timedelta(days=n if n < 60 else n-1)).isoformat()
    if n < 0:
        raise ValueError('Negative Excel date')
    return (date(1904, 1, 1) + timedelta(days=n)).isoformat()

def audit(path, epoch):
    with open(path, newline='', encoding='utf-8-sig') as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        if any('tenant' in h.lower() or 'note' in h.lower() for h in headers):
            raise ValueError('Private columns detected; refusing to process export')
        if len(headers) != len(set(headers)):
            raise ValueError('Duplicate headers')
        rows = list(reader)
    problems = []
    keys = Counter()
    for row_number, row in enumerate(rows, 2):
        keys[(row['building'], row['unit_id'])] += 1
        for name in ['building', 'unit_id', 'program', 'status']:
            if not row[name].strip():
                problems.append({'row': row_number, 'field': name, 'reason': 'Required value missing'})
        for name, raw in row.items():
            if name in TEXT or not raw.strip():
                continue
            try:
                value = Decimal(raw)
                if not value.is_finite():
                    raise ValueError('Nonfinite value')
                if name in INTEGER and value != value.to_integral_value():
                    raise ValueError('Expected integer')
                if name in DATES:
                    if epoch:
                        excel_date(raw, epoch)
                    elif value != value.to_integral_value() or value <= 0:
                        raise ValueError('Invalid date serial')
            except (InvalidOperation, ValueError, OverflowError):
                problems.append({'row': row_number, 'unit_id': row['unit_id'], 'field': name, 'value': raw, 'reason': 'Invalid date' if name in DATES else 'Invalid numeric value'})
    market = [r for r in rows if r['program'] == 'Market']
    status = Counter(r['status'] for r in market)
    return {'records': len(rows), 'unique_unit_keys': len(keys), 'duplicate_keys': sum(n-1 for n in keys.values()), 'program_counts': dict(Counter(r['program'] for r in rows)), 'market_status': dict(status), 'market_leased_percent': round(100*status['Signed']/len(market), 1) if market else None, 'date_system': epoch or 'unconfirmed: CSV has no epoch metadata', 'problems': problems, 'headers': headers}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('csv_path')
    parser.add_argument('--date-system', choices=['1900', '1904'])
    args = parser.parse_args()
    print(json.dumps(audit(args.csv_path, args.date_system), indent=2))
