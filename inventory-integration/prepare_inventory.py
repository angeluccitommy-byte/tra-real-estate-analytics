"""Prepare a local, privacy-safe inventory candidate. No network or database writes."""
import argparse
from collections import Counter
import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path

from validate_inventory import excel_date

FIELDS = {
    'building': ('building', 'text'),
    'unit_id': ('unit_id', 'text'),
    'floor': ('floor', 'integer'),
    'unit_type': ('unit_type', 'text'),
    'bedrooms': ('bedrooms', 'integer'),
    'bathrooms': ('bathrooms', 'numeric'),
    'square_feet': ('square_feet', 'integer'),
    'program': ('inventory_category', 'text'),
    'status': ('lease_status', 'text'),
    'gross_rent': ('gross_rent', 'numeric'),
    'free_months': ('free_months', 'numeric'),
    'lease_term': ('lease_term_months', 'numeric'),
    'net_effective': ('net_effective_rent', 'numeric'),
    'gross_rent_psf_year': ('gross_rent_psf_year', 'numeric'),
    'net_rent_psf_year': ('net_rent_psf_year', 'numeric'),
    'early_occupancy_start': ('early_occupancy_start', 'date'),
    'lease_start': ('lease_start', 'date'),
    'early_cancellation_option': ('early_cancellation_date', 'date'),
    'lease_expiration': ('lease_expiration', 'date'),
    'actual_occupancy': ('actual_occupancy', 'numeric'),
    'total_free_rent': ('total_free_rent', 'numeric'),
    'gross_monthly': ('gross_monthly', 'numeric'),
    'gross_annualized': ('gross_annualized', 'numeric'),
    'monthly_net_effective': ('monthly_net_effective', 'numeric'),
    'annualized_net_rent': ('annualized_net_rent', 'numeric'),
    'annual_net_psf': ('annual_net_psf', 'numeric'),
    'application_date': ('application_date', 'date'),
    'signed_date': ('signed_date', 'date'),
    'base_gross_rent': ('base_gross_rent', 'numeric'),
    'outdoor_space': ('outdoor_space', 'text'),
    'net_op': ('net_op', 'numeric'),
    'gross_op': ('gross_op', 'numeric'),
    'direction': ('direction', 'text'),
}
REQUIRED = {'building', 'unit_id', 'inventory_category', 'lease_status'}


def prepare(path, *, allow_legacy=False):
    rows, issues, keys = [], [], set()
    with open(path, encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        headers = reader.fieldnames or []
        legacy_headers = (set(FIELDS) - {'outdoor_space','direction'}) | {'source','renewal'}
        legacy = allow_legacy and set(headers) == legacy_headers
        if len(headers) != len(set(headers)) or (set(headers) != set(FIELDS) and not legacy):
            raise ValueError('Input must contain exactly the 33 approved nonprivate headers')
        for line, raw in enumerate(reader, 2):
            if None in raw or any(v is None for v in raw.values()):
                raise ValueError(f'CSV row {line}: wrong number of cells')
            if legacy:
                raw.pop('source'); raw.pop('renewal')
                raw.update(outdoor_space='', direction='')
            row = {}
            for header, (field, kind) in FIELDS.items():
                value = raw[header].strip()
                if not value:
                    row[field] = None
                elif kind == 'text':
                    row[field] = value
                elif kind == 'date':
                    try:
                        row[field] = excel_date(value, '1900')
                    except (ValueError, ArithmeticError, OverflowError):
                        row[field] = None
                        issue = {'building': raw['building'].strip(), 'unit_id': raw['unit_id'].strip(), 'field': field, 'csv_line': line, 'reason': 'Invalid Excel 1900 date; source correction required', 'source_value': value}
                        issues.append(issue)
                else:
                    try:
                        number = Decimal(value)
                        if not number.is_finite() or (kind == 'integer' and number != number.to_integral_value()):
                            raise ValueError()
                        row[field] = number
                    except (ValueError, ArithmeticError):
                        raise ValueError(f'CSV row {line}: invalid {kind} in {header}') from None
            if any(row[field] is None for field in REQUIRED):
                raise ValueError(f'CSV row {line}: missing required identity/category/status')
            key = (row['building'], row['unit_id'])
            if key in keys:
                raise ValueError(f'CSV row {line}: duplicate unit key')
            keys.add(key)
            rows.append(row)
    market = [r for r in rows if r['inventory_category'] == 'Market']
    statuses = Counter(r['lease_status'] for r in market)
    report = {'source_sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'date_system': '1900', 'records': len(rows), 'unique_units': len(keys), 'categories': dict(Counter(r['inventory_category'] for r in rows)), 'market_kpis': {'total': len(market), 'available': statuses['Available'], 'signed': statuses['Signed'], 'leased_percent': round(100 * statuses['Signed'] / len(market), 1) if market else None}, 'date_correction_flags': issues, 'invalid_dates_are_null': True, 'units_dropped_for_invalid_dates': 0, 'production_modified': False}
    return rows, report


def json_exact(value):
    """Emit Decimal as JSON numbers without a float conversion or precision loss."""
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('Nonfinite JSON number')
        return str(value)
    if isinstance(value, dict):
        return '{' + ','.join(json.dumps(k) + ':' + json_exact(v) for k, v in value.items()) + '}'
    if isinstance(value, list):
        return '[' + ','.join(json_exact(v) for v in value) + ']'
    return json.dumps(value, allow_nan=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv_path')
    parser.add_argument('output_directory')
    args = parser.parse_args()
    rows, report = prepare(args.csv_path)
    output = Path(args.output_directory)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'inventory-candidate.json').write_text(json_exact(rows) + '\n')
    (output / 'inventory-validation.json').write_text(json.dumps(report, indent=2) + '\n')
    (output / 'inventory-field-mapping.json').write_text(json.dumps({source: {'field': target, 'sql_type': kind} for source, (target, kind) in FIELDS.items()}, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'date_correction_flags'}, indent=2))
    print('Source correction flags:', len(report['date_correction_flags']))
