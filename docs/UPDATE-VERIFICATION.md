# Release update verification — Command Center 0.2.0

Status: implemented locally; publication/production deployment not performed.

The approved flow uses opt-in six-hour checks, stable releases, explicit final
confirmation, Later (24 hours), and Skip this version. Device-card firmware
controls mirror CE 1.2.0C state and remain separate from device control.

## Checks passed

- 128 server tests and 39 client tests (`npm test`).
- 39 integration tests (`npm run test:integration`; overlap with server tests).
- Lint and formatting (`npm run lint`, `npm run format:check`).
- Existing browser smoke/accessibility test (`npm run test:e2e:smoke`), including
  the final production client build.
- Isolated browser verification with the real update service and simulated
  newer releases: cancellation creates no host request; confirmation pins the
  displayed tag and records explicit user approval. Later/Skip keep manual
  installation available. Simulated firmware failure does not retry.
- Desktop/mobile layout inspection, with no horizontal overflow at 390px.
- Real CE 1.2.0C retained state parsed by the actual MQTT mirror in an isolated
  database; controller and Command Center share preferences without journal edits.
- API checks reject stale firmware versions and missing confirmation before any
  MQTT publish. Migration disables old unattended preferences and preserves data.
- Host-request tests consume and reject legacy automatic/unconfirmed requests
  without running Git or Docker.

Screenshots: `output/playwright/release-updates-desktop.png`,
`release-updates-mobile.png`, `command-center-update-settings.png`, and
`standalone-release-updates.png` (ignored local evidence).

## Remaining release gates

A real Linux/Pi host update through Docker rebuild/restart and recovery has not
been performed in this session. The existing backup-first updater now verifies
both service readiness and the running server version; this requires release-host
validation before publication. The official firmware HTTPS download/install and full-download checksum-mismatch
rejection passed on hardware using a temporary older-labeled build and the
existing published v1.1.0C release. The final 1.2.0C candidate is restored afterward.
Transfer interruption and boot rollback of the eventual frozen release candidate
remain release gates.
See the companion firmware repository's `docs/UPDATE-VERIFICATION.md` for exact
firmware hashes, bench evidence, commands, and release gates.

Windows/macOS retain command-line updates. No production database was migrated
or restored during these tests. Neither release was published.
