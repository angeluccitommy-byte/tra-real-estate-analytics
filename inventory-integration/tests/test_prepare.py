import csv
from decimal import Decimal
import io
import json
from pathlib import Path
import tempfile
import unittest
from prepare_inventory import FIELDS, excel_date, json_exact, prepare

from synthetic import paths
SOURCE,_,_=paths()

class InventoryTests(unittest.TestCase):
    def test_excel_boundaries(self):
        for serial, expected in [('1', '1900-01-01'), ('59', '1900-02-28'), ('61', '1900-03-01'), ('50000', '2036-11-21')]:
            self.assertEqual(excel_date(serial, '1900'), expected)
        for invalid in ['60', '0', 'NaN', 'Infinity', '1.5', 'invalid-date']:
            with self.assertRaises((ValueError, ArithmeticError)):
                excel_date(invalid, '1900')

    def test_export_retained_and_dates_flagged(self):
        rows, report = prepare(SOURCE, allow_legacy=True)
        self.assertEqual(report['categories'], {'Market': 384, 'Affordable': 133})
        self.assertEqual(report['unique_units'], 517)
        self.assertEqual(report['market_kpis']['total'],384)
        self.assertEqual(report['market_kpis']['available']+report['market_kpis']['signed'],384)
        expected = {('TEST-0001', 'lease_start'), ('TEST-0002', 'lease_expiration'), ('TEST-0003', 'lease_expiration')}
        self.assertEqual({(i['unit_id'], i['field']) for i in report['date_correction_flags']}, expected)
        for issue in report['date_correction_flags']:
            row = next(r for r in rows if r['unit_id'] == issue['unit_id'])
            self.assertIsNone(row[issue['field']])
        self.assertTrue(all(len(row) == 33 for row in rows))
        self.assertTrue(all(r['actual_occupancy'] is None or isinstance(r['actual_occupancy'], Decimal) for r in rows))
        with SOURCE.open(newline='', encoding='utf-8-sig') as stream:
            raw = list(csv.DictReader(stream))
        for original, converted in zip(raw, rows):
            for name, (target, kind) in FIELDS.items():
                if kind not in ['integer', 'numeric']:
                    continue
                self.assertEqual(converted[target], Decimal(original[name]) if original[name] else None)
        # Numeric JSON encoding preserves Decimal digits instead of using binary floats.
        decoded = json.loads(json_exact(rows), parse_float=Decimal, parse_int=Decimal)
        self.assertEqual(decoded, rows)

    def test_unsafe_headers_and_duplicate_units_rejected(self):
        with SOURCE.open(newline='', encoding='utf-8-sig') as stream:
            reader = csv.DictReader(stream)
            headers = reader.fieldnames
            first = next(reader)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'input.csv'
            for fields, records in [(headers + ['tenant_name'], [dict(first, tenant_name='')]), (headers, [first, first])]:
                with path.open('w', newline='') as stream:
                    writer = csv.DictWriter(stream, fieldnames=fields)
                    writer.writeheader()
                    writer.writerows(records)
                with self.assertRaises(ValueError):
                    prepare(path, allow_legacy=True)

if __name__ == '__main__':
    unittest.main()
