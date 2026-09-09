# Command Center v0.2.0 release evidence

Status: passed

- Command Center candidate commit: `22b85ccd6b1f4503c809700b4e20c24587fa69eb`
- CE firmware candidate commit: `644bf1b7dc2eb6dd49b9abccd01593bd5c3c460f`
- Linux/Pi update rehearsal: passed on the live Raspberry Pi ARM64 deployment
- Current CI runs: Command Center 34340019516; CE firmware 34340087259
- Tested by: Codex release verification with repository-owner approval
- Tested at: 2026-09-09T15:00:00Z

Prior v0.1.0 evidence establishes the baseline, not validation of this release.
Implementation results are in `docs/UPDATE-VERIFICATION.md` and
`docs/DASHBOARD-JOURNAL-VERIFICATION.md`.

## Release candidate

- [x] Commit and push the reviewed dashboard, journal, and update changes.
- [x] Record successful current CI runs, including security, browser, host-platform,
      Compose, and AMD64/ARM64 image checks.
- [x] Rehearse the update on the available Linux/Pi deployment after preserving
      an off-host backup:
      backup before changes, exact target version, restart, health, and retained data.
- [x] Rehearse update failure/recovery without automatic retries or implicit data restore.
- [x] Verify the dashboard/journal migration against a copied previous-release database.
- [x] Complete the focused keyboard/screen-reader check for the new controls.
- [x] Record the exact tested CE firmware candidate and release artifact evidence.
- [x] Review final release notes and rollback/recovery instructions.

## Local release preparation — 2026-09-08

- Acceptance: current-release evidence is now mandatory. Four validator tests
  pass; the release gate correctly remains closed while this record is pending.
- Acceptance: local quality/security checks pass with 128 server tests, 40 client
  and release tests, 39 integration tests, lint, formatting, and production build.
  These counts include overlap between server and integration suites.
- Registry signatures verify for 250 client and 148 server packages.
- Compatible audit remediation updates `body-parser` to 1.20.8 and pins its
  transitive `qs` dependency to patched 6.16.0. Both client and server audits
  report zero vulnerabilities. The complete server suite passes with the override.

Commands run from the Command Center repository (Node 24):

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
npx prettier --write scripts/release-readiness.js test/release/releaseReadiness.test.js
node --test test/release/releaseReadiness.test.js
RELEASE_TAG=v0.2.0 npm run release:validate
npm run verify
npm audit fix --prefix deploy/server
npm ls --prefix deploy/server qs body-parser express
npm view express@4 version dependencies.qs --json
npm run verify
npm run security:signatures
git diff --check
docker info --format '{{.ServerVersion}}'
```

The validator's initial nonzero exit was expected while this evidence was pending.
Full local output is retained
outside Git in `/tmp/growhub-release-verify.log` and
`/tmp/growhub-release-signatures.log`.

## Linux/Pi deployment and recovery evidence

- Source deployment started at Command Center 0.1.0 with a clean checkout,
  Docker Compose 5.3.1, Node 24.18.0, and the systemd update path active.
- A consistent full backup of the server and bundled MQTT volumes was created,
  checksum-verified, and copied off-host before migration. MQTT and Command
  Center were stopped only for that archive operation.
- Restart exposed a pre-existing 0.1.0 retention defect: startup tried to delete
  an old device action still referenced by a setup-review audit row. SQLite
  rejected the deletion. MQTT recovered independently and no data was changed.
- The retention query now preserves referenced audit actions. A regression for
  the exact relationship passes, along with all 129 server tests. Candidate
  commit `8a99448ff7e5e497825072882789eb0ebc7d628a` restored the live deployment;
  final candidate `8685e6e2c053ba1c8a8ba0fc5cbc138730d3eb73` adds the audited dependency fix.
- Migrations 007 and 008 were first applied to the off-host copy. Schema moved
  from 6 to 8, integrity and foreign-key checks passed, all pre-existing table
  rows and values remained unchanged, 99 legacy operational events were copied,
  and reopening was idempotent. Unattended updates remained disabled.
- The live deployment then migrated to schema 8 and Command Center 0.2.0. It
  retained four devices, 1,539,934 sensor samples, 100 journal entries, and 99
  migrated operational events; integrity and foreign-key checks passed. MQTT
  reconnected and both containers became healthy.
- A second backup-first update installed the final dependency-pinned candidate.
  The live server reports Command Center 0.2.0 and `qs` 6.16.0; both containers
  remain healthy.
- The real Pi ran the host-agent regression: automatic and unconfirmed requests
  were consumed once, rejected, and not retried. The systemd path remained active.

## Firmware artifact evidence

- CE source candidate: `5fad38eff1400add60a7e6ec7a37ec090ad48daf`;
  manifest/evidence commit: `644bf1b7dc2eb6dd49b9abccd01593bd5c3c460f`.
- Exact Linux CI firmware SHA-256:
  `6237d69d0d872335374fe2accdf71a0eca611b2db8da151ba3a3bdff1d43e510`.
- Exact Linux CI first-flash ZIP SHA-256:
  `45c7d2873eed38b9abc79d02b3a0e1e43812c59120a5378478ad83b9c927fd2f`.
- The exact CI application image booted on the selected bench controller with
  identity, idle outlets, Wi-Fi, MQTT, valid time, and update preference retained.
  An interrupted upload left the running slot unchanged. An isolated health-fault
  image booted, failed validation, and rolled back to the exact CI image.

## Focused accessibility evidence

- Current CI passed the complete browser/accessibility suite.
- In a disposable real-browser fixture, accessible names and state were present
  for the update region, status, preference, exact-version actions, release links,
  and dashboard collapse controls. Keyboard Enter activated Check now and exposed
  the available release. Keyboard activation of Update now opened the exact-version
  confirmation describing backup and restart impact. Cancel created no request.
  The browser console contained no errors.
