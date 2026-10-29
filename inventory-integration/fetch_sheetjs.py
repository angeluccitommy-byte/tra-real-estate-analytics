"""Vendor the exact official SheetJS 0.20.3 artifact with a trusted expected SHA-256."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request

URL='https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'
class HTTPSOfficialOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,url):
        parsed=urllib.parse.urlparse(url)
        if parsed.scheme!='https' or parsed.hostname!='cdn.sheetjs.com':raise ValueError('Unexpected dependency redirect')
        return super().redirect_request(request,fp,code,message,headers,url)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha256',required=True,help='Digest from the trusted official/production artifact, never guessed')
    parser.add_argument('--from-file',help='Optional verified production vendor artifact; never deploy the reference function')
    args=parser.parse_args()
    if not re.fullmatch('[a-fA-F0-9]{64}',args.expected_sha256):raise ValueError('A trusted expected SHA-256 is required')
    target=Path(__file__).resolve().parents[1]/'supabase/functions/tra-inventory-sync/vendor/xlsx.mjs'
    existed=target.exists()
    if existed:data=target.read_bytes()
    elif args.from_file:data=Path(args.from_file).read_bytes()
    else:
        with urllib.request.build_opener(HTTPSOfficialOnly).open(URL,timeout=30) as response:data=response.read(3_000_001)
    digest=hashlib.sha256(data).hexdigest()
    if len(data)>3_000_000 or digest!=args.expected_sha256.lower():raise ValueError('SheetJS artifact verification failed; no file written')
    if not target.exists():target.write_bytes(data)
    provenance=target.parent/'provenance.json'
    if not (existed and provenance.exists()):
        origin='existing verified artifact' if existed else 'verified production artifact' if args.from_file else 'official TLS-verified release'
        provenance.write_text(json.dumps({'version':'0.20.3','official_url':URL,'sha256':digest,'origin':origin},indent=2)+'\n')
    print('SheetJS 0.20.3 verified and vendored for the new function only.')
if __name__=='__main__':main()
