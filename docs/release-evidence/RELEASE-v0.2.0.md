# Command Center v0.2.0 release evidence

Status: pending

- Command Center candidate commit: pending
- CE firmware candidate commit: pending
- Linux/Pi update rehearsal: pending
- Current CI runs: pending
- Tested by: pending
- Tested at: pending

Prior v0.1.0 evidence establishes the baseline, not validation of this release.
Implementation results are in `docs/UPDATE-VERIFICATION.md` and
`docs/DASHBOARD-JOURNAL-VERIFICATION.md`.

## Release candidate

- [ ] Commit and push the reviewed dashboard, journal, and update changes.
- [ ] Record successful current CI runs, including security, browser, host-platform,
      Compose, and AMD64/ARM64 image checks.
- [ ] Rehearse the user-confirmed update on an isolated Linux/Pi deployment:
      backup before changes, exact target version, restart, health, and retained data.
- [ ] Rehearse update failure/recovery without automatic retries or implicit data restore.
- [ ] Verify the dashboard/journal migration against a copied previous-release database.
- [ ] Complete the focused keyboard/screen-reader check for the new controls.
- [ ] Record the exact tested CE firmware candidate and release artifact evidence.
- [ ] Review final release notes and rollback/recovery instructions.

## Local release preparation — 2026-09-08

- Acceptance: current-release evidence is now mandatory. Four validator tests
  pass; the release gate correctly remains closed while this record is pending.
- Acceptance: local quality/security checks pass with 128 server tests, 40 client
  and release tests, 39 integration tests, lint, formatting, and production build.
  These counts include overlap between server and integration suites.
- Registry signatures verify for 250 client and 148 server packages.
- Compatible audit remediation updated body-parser to 1.20.8 and its nested qs to
  6.16.0. Two moderate findings remain through Express 4.22.2's qs ~6.15.1
  constraint; the configured high-severity gate passes. Resolve or assess these
  before release. No dependency override or major Express upgrade was applied.
- Docker availability check failed because the local daemon is stopped. No
  containers were changed; Linux/Pi update rehearsal remains pending.

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

The validator's nonzero exit is expected pending release evidence. The audit-fix
command returned nonzero because two moderate findings remain; the subsequent
full verification and signature checks passed. Full local output is retained
outside Git in `/tmp/growhub-release-verify.log` and
`/tmp/growhub-release-signatures.log`.
