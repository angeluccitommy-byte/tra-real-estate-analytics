import csv
import json
import os
from pathlib import Path
import tempfile
import unittest
from prepare_inventory import prepare
from validate_latest_export import validate

from synthetic import paths
BASELINE,LATEST,REPORT=paths()

class LatestTests(unittest.TestCase):
    def test_latest_count_keys_dates_and_mapping_drift(self):
        rows,report=validate(LATEST,REPORT)
        original,_=prepare(BASELINE, allow_legacy=True)
        self.assertEqual({(r['building'],r['unit_id']) for r in rows},{(r['building'],r['unit_id']) for r in original})
        self.assertEqual(report['categories'],{'Market':384,'Affordable':133})
        self.assertEqual(report['unique_units'],517)
        self.assertEqual(report['market_kpis']['total'],384)
        self.assertEqual(len(report['date_correction_flags']),1)
        self.assertEqual(report['date_correction_flags'][0]['unit_id'],'TEST-0003')
        self.assertEqual(next(r for r in rows if r['unit_id']=='TEST-0001')['lease_start'],json.loads(REPORT.read_text())['date_checks'][0]['date'])
        self.assertEqual(next(r for r in rows if r['unit_id']=='TEST-0002')['lease_expiration'],json.loads(REPORT.read_text())['date_checks'][1]['date'])
        self.assertIsNone(next(r for r in rows if r['unit_id']=='TEST-0003')['lease_expiration'])
        self.assertEqual(report['approved_fields_absent'],[])
        self.assertTrue(report['schema_compatible_without_review'])
        self.assertTrue(all(len(r)==33 and 'outdoor_space' in r and 'direction' in r for r in rows))
        with LATEST.open(encoding='utf-8-sig',newline='') as stream:
            for raw,converted in zip(csv.DictReader(stream),rows):
                self.assertEqual(converted['outdoor_space'],raw['Outdoor Space'].strip() or None)
                self.assertEqual(converted['direction'],raw['Direction'].strip() or None)

    def test_disagreement_cannot_mark_null_date_valid(self):
        supplied=json.loads(REPORT.read_text())
        supplied['date_checks'][2].update(status='valid',date='2030-01-01') # synthetic conflicting report, not a correction
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'bad-report.json';path.write_text(json.dumps(supplied))
            with self.assertRaisesRegex(ValueError,'disagrees'):
                validate(LATEST,path)

    def test_private_extra_headers_rejected(self):
        with LATEST.open(encoding='utf-8-sig',newline='') as stream:
            reader=csv.DictReader(stream);headers=reader.fieldnames;row=next(reader)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'bad.csv'
            with path.open('w',newline='') as stream:
                writer=csv.DictWriter(stream,fieldnames=headers+['Tenant Name']);writer.writeheader();writer.writerow(row)
            with self.assertRaisesRegex(ValueError,'headers'):
                validate(path,REPORT)

if __name__=='__main__':unittest.main()
