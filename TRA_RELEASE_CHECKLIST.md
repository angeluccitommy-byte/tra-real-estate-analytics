# TRA release checklist (PR #2)

## Current status
- [x] Original TRA palette retained.
- [x] Approved sidebar order added (14 entries including 360°).
- [x] Quarterly, Six-Month, Twelve-Month views created.
- [x] Snapshot KPI totals and recorded-traffic charts inserted.
- [x] Static structural check: 13 internal views and corresponding navigation entries; 13 opening and closing section tags.
- [ ] Verify workbook report calculations against the source file, including month boundaries and signed lease counts.
- [ ] Wire new report pages to a versioned, automatically refreshed export; do not treat snapshot as live.
- [ ] Test desktop/mobile navigation, charts, login/logout, inventory, financial pages and 360° link in browser.
- [ ] Verify GitHub Pages/custom-domain deployment configuration and production data update schedule.
- [ ] Resolve GitHub PR mergeability; PR #2 currently reports mergeable=false.
- [ ] Confirm deployment and compare live page with release branch; maintain rollback path.

## Data caveat
The 117 visits represent October (74) and November (43) records available in the workbook snapshot, not full six- or twelve-month traffic coverage. Earlier month bars are not reliable zero-traffic assertions. The new pages explicitly identify this limitation.

## Release rule
Do not merge or deploy until automated data integration, browser QA and mergeability checks pass. Existing production website remains unchanged until then.
