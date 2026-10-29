import hashlib
import io
from contextlib import redirect_stdout
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import fetch_sheetjs

class VendorTests(unittest.TestCase):
    def test_checksum_required_before_any_vendor_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);script=root/'integration/fetch_sheetjs.py';script.parent.mkdir()
            target=root/'supabase/functions/tra-inventory-sync/vendor/xlsx.mjs';target.parent.mkdir(parents=True)
            fixture=root/'fixture.mjs';fixture.write_bytes(b'// synthetic checksum test, not a real SheetJS distribution\n')
            with redirect_stdout(io.StringIO()),patch.object(fetch_sheetjs,'__file__',str(script)),patch('sys.argv',['fetch','--from-file',str(fixture),'--expected-sha256','0'*64]):
                with self.assertRaisesRegex(ValueError,'verification failed'):fetch_sheetjs.main()
            self.assertFalse(target.exists())
    def test_verified_bytes_and_provenance_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);script=root/'integration/fetch_sheetjs.py';script.parent.mkdir()
            target=root/'supabase/functions/tra-inventory-sync/vendor/xlsx.mjs';target.parent.mkdir(parents=True)
            fixture=root/'fixture.mjs';fixture.write_bytes(b'// synthetic integrity test only\n')
            digest=hashlib.sha256(fixture.read_bytes()).hexdigest()
            with redirect_stdout(io.StringIO()),patch.object(fetch_sheetjs,'__file__',str(script)),patch('sys.argv',['fetch','--from-file',str(fixture),'--expected-sha256',digest]):fetch_sheetjs.main()
            self.assertEqual(target.read_bytes(),fixture.read_bytes())
            before=(target.parent/'provenance.json').read_bytes()
            with redirect_stdout(io.StringIO()),patch.object(fetch_sheetjs,'__file__',str(script)),patch('sys.argv',['fetch','--expected-sha256',digest]):fetch_sheetjs.main()
            self.assertEqual((target.parent/'provenance.json').read_bytes(),before)
            self.assertEqual(json.loads(before)['sha256'],digest)

if __name__=='__main__':unittest.main()
