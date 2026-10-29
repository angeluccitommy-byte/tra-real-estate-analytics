Required artifact: SheetJS 0.20.3, xlsx.mjs, official release URL:
https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs

The source reference ZIP omits it. It remains missing: the official HTTPS endpoint
is blocked by the current cloud proxy (403). No checksum has been invented.

Obtain its expected SHA-256 from the trusted official or authorized production
vendor artifact. Run inventory-integration/fetch_sheetjs.py --expected-sha256
with that digest, optionally --from-file /secure/path/to/the/verified/xlsx.mjs.
The helper preserves TLS verification, checks the digest before writing, and
records provenance.json. It writes only this new function's vendor file. Never
replace the production function or substitute the older npm xlsx package.

Then run a real XLSM decoding comparison and Deno check/bundle before deployment.
