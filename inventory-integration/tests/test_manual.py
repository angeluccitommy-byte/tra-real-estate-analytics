import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from prepare_inventory import json_exact
from validate_latest_export import validate
from validate_manual_import import verify_rows,validate_remote

from synthetic import paths
_,CSV,REPORT=paths()

class ManualTests(unittest.TestCase):
    def setUp(self):
        self.rows,self.report=validate(CSV,REPORT)
        self.actual=json.loads(json_exact(self.rows))
        self.batch={'id':'fixture-batch','total_units':517,'market_units':384,'affordable_units':133,'date_issues':self.report['date_correction_flags']}
    def test_exact_fields_and_values_required(self):
        verify_rows(self.rows,self.actual)
        for field,value in [('outdoor_space','WRONG'),('direction','WRONG'),('gross_rent',999999)]:
            changed=json.loads(json_exact(self.rows));changed[0][field]=value
            with self.assertRaisesRegex(ValueError,'mismatch'):verify_rows(self.rows,changed)
        with self.assertRaisesRegex(ValueError,'Incomplete'):verify_rows(self.rows,self.actual[:-1])
    def required(self,path,key,token=None,payload=None):
        if path=='/auth/v1/user':return {'id':'approved' if token=='good-fixture' else 'unapproved'}
        if path.startswith('/rest/v1/tra_inventory_batches?'):return [self.batch]
        from urllib.parse import parse_qs,urlparse
        offset=int(parse_qs(urlparse(path).query)['offset'][0])
        return self.actual[offset:offset+200]
    def test_positive_and_negative_read_checks(self):
        with patch('validate_manual_import.required',side_effect=self.required),patch('validate_manual_import.request',return_value=(403,None)):
            rows,batch=validate_remote(self.rows,self.report,'public-fixture','good-fixture','bad-fixture')
            self.assertEqual(len(rows),517)
        with patch('validate_manual_import.required',side_effect=self.required),patch('validate_manual_import.request',return_value=(200,[{'unit_id':'exposed'}])):
            with self.assertRaisesRegex(ValueError,'not denied'):validate_remote(self.rows,self.report,'public-fixture','good-fixture','bad-fixture')
    def test_unexpected_flags_fail(self):
        self.batch['date_issues']=[]
        with patch('validate_manual_import.required',side_effect=self.required),patch('validate_manual_import.request',return_value=(403,None)):
            with self.assertRaisesRegex(ValueError,'flags disagree'):validate_remote(self.rows,self.report,'public-fixture','good-fixture','bad-fixture')

if __name__=='__main__':unittest.main()
