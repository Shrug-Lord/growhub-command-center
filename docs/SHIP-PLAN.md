# Growhub Command Center CE ship plan

Status: `v0.1.0` released. Architecture, implementation, public-host CI, the
multi-architecture release image, hardware evidence, deployment rehearsals,
GitHub repository security settings, and focused manual accessibility evidence
are complete.

## Target baseline

- Keep the existing React/Vite frontend, Node/Express server, SQLite persistence, and MQTT.js integration.
- Use Node.js 24 LTS for development, CI, and the server container.
- Keep one Command Center API process per installation and one server-owned MQTT client.
- Make Docker Compose the primary cross-platform deployment for Windows, macOS, and Linux hosts, including Raspberry Pi, mini PC, and laptop hardware. Support both ARM64 and AMD64 container platforms; neither CPU architecture is a user requirement.
- Serve the UI and API from one origin, publishing host port 80 by default for `http://growhub.local` or the host's configured name/IP.
- Bundle Mosquitto for the normal deployment. External brokers remain an advanced override.
- Treat CE firmware as authoritative for presence, active schedule, outlet assignment/labels, relay mode, relay outputs, and device health.
- Treat Command Center as authoritative for reusable templates, template revisions, role mappings, expected schedule links, setup review, action history, device events, sessions, and diagnostics metadata.
- Document CE `1.1.0C` as the initial tested baseline, while gating runtime workflows on validated MQTT capabilities and payload contract versions rather than a display-version string alone.

## Release evidence

| Area | Implemented | Remaining evidence |
|---|---|---|
| Authentication and browser transport | UI-only setup, server-side sessions, CSRF, rate limits, same-origin typed APIs, no browser MQTT, automated Axe coverage, and passed manual keyboard/VoiceOver evidence | None |
| Firmware integration | Closed CE subscriptions, authoritative mirrors, full outlet writes, CE v3 schedules, time and relay actions, confirmed lifecycle, drift, diagnostics, and passed CE 1.1.0C hardware evidence | None |
| Operations | Port 80 Compose stack, bundled broker, health checks, backup, checksum-validated restore, update, reset, plus passed Raspberry Pi ARM64 and macOS ARM64 clean-host rehearsals | None |
| Quality | Lint, formatting, 121 server/client/release tests, 26 integration tests, production build, Playwright, Axe, secret scan, audits, signatures, container smoke, and real bundled-Mosquitto retained-state rebuild | None |
| GitHub release | Public `v0.1.0` release, private vulnerability reporting, immutable-pinned CI actions, gated tag workflow, MIT license, security and contribution docs, issue templates, truthful screenshot, checksums, public multi-arch image, attestations, and passed accessibility evidence | None |

## Canonical action contract

Submit actions through `POST /api/v1/devices/:deviceId/actions` with a closed discriminated body:

```json
{
  "type": "set_manual_outlet_state",
  "input": {
    "outlet_id": 2,
    "target_state": "on"
  }
}
```

The browser cannot submit MQTT topics, raw MQTT payloads, QoS, arbitrary action context, or an arbitrary type. Read-only preflight remains separate from final action submission.

| Action | Execution | Authoritative completion |
|---|---|---|
| `load_schedule` | MQTT `grow` | Newer normalized `schedule/state.schedule` equals compiled CE v3 payload |
| `reload_expected_schedule` | MQTT `grow` | Newer normalized schedule equals stored expected payload |
| `update_outlet_config` | MQTT `outlets/config` | Newer full normalized outlet state equals intended replacement |
| `repair_outlet_label` | MQTT `outlets/config` | Newer full normalized outlet state equals intended replacement |
| `sync_time` | MQTT `time/action` | Newer schedule state has `source: time` and `time_valid: true` |
| `switch_to_manual` | MQTT `control/mode` value `2` | Newer schedule state has MANUAL mode |
| `return_to_auto` | MQTT `control/mode` value `3` | Newer schedule state has AUTO mode |
| `set_manual_outlet_state` | MQTT `control/relay` | Newer MANUAL state matches intended complete four-outlet mask |
| `emergency_all_off` | MQTT `control/mode` value `7` | Newer MANUAL state contains all four outlets OFF |
| `run_water_pump_now` | MQTT `schedule/action` | Newer AUTO state shows selected pump outlet ON |
| `save_as_new_template` | Local SQLite transaction | Template/revision, expectation, drift reconciliation, event, and action commit atomically |
| `acknowledge_drift` | Local SQLite transaction | Expectation unlink, drift reconciliation, event, and action commit atomically |
| `acknowledge_label_drift` | Local SQLite transaction | Mapping label snapshot and action commit atomically |
| `confirm_device_setup` | Local SQLite transaction | Current outlet fingerprint review and action commit atomically |

MQTT-backed actions use a 15-second absolute confirmation deadline from transport handoff. Confirmation and rejection require a newer persisted state/error sequence than the action's captured base. Terminal results are immutable. No action is automatically replayed, and explicit retries create new actions after fresh preflight.

## Implementation phases

### Phase 1: Runtime and persistence foundation

Implementation status:

- [x] Phase 1A: validated configuration, structured redacted logging foundation, injectable runtime clocks/timers, testable server bootstrap, request IDs, typed framework errors, liveness/readiness, and bounded graceful shutdown.
- [x] Phase 1B: OS-backed app-data lock, clean numbered CE schema migrations, legacy bench-schema refusal, and explicit development reset.
- [x] Phase 1C: complete API success/error cutover, shutdown-aware client behavior, production log policy, and full runtime integration coverage.

- Replace ad hoc startup with validated configuration, structured redacted logging, request IDs, app-data locking, migrations, graceful shutdown, and liveness/readiness endpoints.
- Create the clean CE-aligned SQLite schema with numbered migrations and an explicit development reset command.
- Add direct named API success shapes and the typed error envelope.
- Keep the server single-process and make clocks/timers injectable for deterministic lifecycle tests.

Exit criteria:

- Fresh app data migrates and starts successfully.
- Legacy bench schema fails with a readable reset instruction instead of being silently destroyed.
- A second server process cannot open the same app-data directory.
- Shutdown, readiness, request IDs, logs, and error redaction pass automated tests.

### Phase 2: Authentication and application shell

Implementation status:

- [x] UI-only first-run admin setup with validated normalized username and self-describing Argon2id password verifier.
- [x] Persistent server-side SQLite sessions, host-only HTTP-only SameSite cookies, rolling expiry, in-memory browser CSRF, logout, credential changes, and complete session revocation.
- [x] Trusted-proxy-aware fixed-window rate limits plus bounded, coalesced, export-redacted auth/security events.
- [x] Removal of default environment credentials, static bearer tokens, legacy auth routes, wildcard production CORS, and browser credential storage.

- Implement UI-based first-run admin setup with a self-describing password hash.
- Implement server-side SQLite sessions, HTTP-only same-site cookies, in-memory browser CSRF token, logout, username change, password change, and session revocation.
- Add process-local fixed-window rate limits and bounded redacted auth/security events.
- Remove default credentials, static bearer tokens, wildcard production CORS, and browser credential storage.

Exit criteria:

- [x] A fresh deployment can be configured entirely in the UI.
- [x] Setup closes permanently after success until app data is intentionally reset.
- [x] Sessions survive normal restart and credential changes revoke all sessions.
- [x] CSRF, auth error privacy, rate-limit boundaries, and export redaction pass tests.

### Phase 3: Firmware mirror and discovery

Implementation status:

- [x] Closed CE topic and payload validation before device discovery or mirror mutation.
- [x] Normalized and raw state mirrors with receive timestamps, state revisions, error sequences, and indexed presence/mode fields.
- [x] Presence-led auto-discovery plus server-owned subscriptions for all CE state and error streams.
- [x] Restart/reconnect rebuild generations, 60-second grace, and bounded retained-state incidents.
- [x] Authenticated device/broker health APIs, browser polling, onboarding state, and removal of browser MQTT/WebSockets.
- [x] Firmware-owned outlet reads plus fail-closed outlet writes until the confirmed device action path is available.

- Subscribe server-side to CE presence, sensor, outlet-state, schedule-state, schedule-error, outlet-error, time-error, and control-error topics.
- Validate every topic identity and payload before mutating the device registry or mirror.
- Persist normalized current mirrors, raw current diagnostic snapshots, receive timestamps, monotonic state revisions, and monotonic error sequences.
- Implement auto-discovery, firmware presence, retained-state rebuild, 60-second missing-state grace, and bounded retained-state incidents.
- Remove browser MQTT and Mosquitto WebSocket exposure from the first-ship path.

Exit criteria:

- [x] A valid CE device appears from retained MQTT without manual registration.
- [x] Invalid topics/payloads cannot create or mutate a device.
- [x] Restart/reconnect rebuilds presence, outlets, schedule, mode, outputs, warnings, and health deterministically.
- [x] Missing retained state affects only dependent workflows and escalates after the documented grace period.
- [x] Firmware missing a required CE contract remains monitorable where possible but receives a typed compatibility blocker for dependent workflows.

### Phase 4: Device action engine

Implementation status:

- [x] Closed canonical action input and persisted pending/terminal lifecycle.
- [x] QoS 1 transport handoff, newer-state/error confirmation, timeout, restart,
  conflict, supersession, and immutable history behavior.
- [x] Typed action and activity APIs plus operator controls.

- Implement canonical actions, closed type/input schemas, blocked attempts, no-ops, request correlation, immutable terminal states, and device-scoped history/activity APIs.
- Persist prepared actions before MQTT handoff, use QoS 1, wait at most three seconds for PUBACK, and apply the 15-second confirmation deadline.
- Implement state and error base revisions, command-family serialization, conflict rules, emergency supersession, timeout reconciliation, and restart recovery.
- Implement normalized firmware rejection mappings and diagnostics-only raw errors.

Exit criteria:

- Every action in the canonical matrix completes, rejects, times out, interrupts, blocks, or no-ops exactly as documented.
- PUBACK alone never completes a device action.
- Restart never republishes an uncertain action or extends its deadline.
- Late state updates the mirror without rewriting terminal history.
- Action and activity pagination remain stable while pending actions become terminal.

### Phase 5: Templates, preflight, and drift

Implementation status:

- [x] Assignment-based templates, immutable revisions, role mappings, and CE v3
  physical schedule compilation.
- [x] Preflight blockers/warnings, expected schedules, update availability,
  label drift, and explicit schedule drift recovery.

- Replace `settings.sockets`, CE v2 schedule compilation, and `schedule_instances` with template roles, revisions, mappings, CE v3 conditions, expected schedules, and drift episodes.
- Implement template validation, device preflight, role inference, explicit duplicate mapping, warnings, compiled preview, and final server-side recheck.
- Implement load/reload actions, expected-schedule establishment only after confirmation, template update availability, and full-replacement warnings.
- Implement label drift repair/acknowledgement, Save as new template, Acknowledge drift, drift detection/reconciliation events, and on-demand human-readable diffs.

Exit criteria:

- One reusable template can load safely to devices with different physical outlet layouts.
- Missing/ambiguous/incompatible assignments block; label drift and extra outlets warn as documented.
- Firmware-local changes remain authoritative and create one drift episode without mutating templates silently.
- Save as new template atomically locks both schedule and outlet fingerprints.
- Template edits never silently update already-running devices.

### Phase 6: Device and schedule user experience

Implementation status:

- [x] Server-owned dashboard, onboarding, setup review, outlet editing, mode and
  manual controls, emergency action, time remediation, Pump Run Now, schedules,
  deployment state, and recent activity.
- [x] Responsive desktop/mobile browser flow with automated accessibility checks.

- Replace the legacy dashboard data flow with authenticated server APIs and server-owned current mirror state.
- Implement onboarding, separate Online/Offline, Setup needs review, Syncing retained state, and Needs attention signals.
- Implement Device setup, full outlet replacement, stale-draft recovery, labels, setup review, and schedule-load gating.
- Implement AUTO/MANUAL mode, per-outlet manual controls, Emergency all-off, Return to AUTO, time remediation, Pump Run Now, pending feedback, and Recent activity.
- Implement template editor, revision/deployment views, preflight review, warning remediation, drift banner/details, and per-device load-latest.
- Preserve current telemetry/history/alarm capability where it remains compatible with the new device model.

Exit criteria:

- Core workflows are usable on desktop and mobile without overlapping controls or hidden blockers.
- Every disabled action has server-derived typed rationale and every pending action remains inspectable after navigation or refresh.
- The UI never directly connects to MQTT, infers action success, or replays a state-changing request automatically.
- Accessibility checks cover keyboard use, focus handling, names, contrast, warning semantics, and inline device-detail/setup behavior.

### Phase 7: Diagnostics and operations

Implementation status:

- [x] Authenticated read-only diagnostics, redacted export, bounded evidence,
  current raw snapshots, action publication details, and schedule diffs.
- [x] Self-contained Compose image plus backup, restore, update, reset, health,
  log rotation, and operations documentation.

- Implement authenticated read-only diagnostics, current raw retained snapshots, generated diffs, bounded events/errors, and the redacted JSON diagnostics export.
- Rework Compose for one-origin server/UI delivery, host port 80, internal port 3000, no browser WebSocket port, local volumes, health checks, restart policy, log rotation, and a 45-second stop grace period.
- Add one-command update, backup, restore, and development reset workflows with safe defaults and clear destructive warnings.
- Document `growhub.local`, hostname/IP fallback, LAN-only MQTT, VPN/reverse-proxy remote access, and advanced external-broker ownership.

Exit criteria:

- Fresh install, update, backup, restore, and reset succeed from documented commands on ARM64 and AMD64 Docker hosts.
- Restore reproduces app state and bundled broker retained state.
- Diagnostics is sufficient to troubleshoot MQTT state and actions without SSH, but cannot publish or mutate state.
- No shipped defaults expose secrets or publish MQTT/WebSocket ports beyond the documented LAN boundary.

### Phase 8: Verification and GitHub release

Implementation status:

- [x] Lint, formatting, unit, integration, API, browser, accessibility,
  dependency audit/signature, secret, production-build, and container scripts.
- [x] Pull-request/push CI and hardware-gated tag release workflow with
  multi-architecture image, source archive, checksums, and attestations.
- [x] Public license, security, contribution, issue, architecture, operations,
  release, screenshot, and compatibility-evidence documentation.
- [x] Isolated ARM64 macOS Docker clean install, retained-state seed, backup,
  destructive volume replacement, and restore rehearsal.
- [x] CE 1.1.0C hardware bench evidence.
- [x] Reference Raspberry Pi deployment/update/restore evidence.
- [x] Public host compatibility CI matrix and multi-architecture release-image build.

- Add lint, formatting, unit, integration, API, browser smoke, full end-to-end, accessibility, dependency audit, and production-build scripts.
- Add CI for supported Node LTS on pull requests and pushes, plus a tag-driven release workflow.
- Add `LICENSE`, security policy, contribution guidance, issue templates, environment examples, architecture links, screenshots, install/update/backup/restore docs, and release notes.
- Bench-test the CE 1.1.0C outlet, time, schedule, mode, relay, error, reconnect, and Pump Run Now contracts on hardware before calling Command Center compatible.
- Test a clean deployment and an update/restore rehearsal on the Raspberry Pi reference host plus one non-Pi Docker host.

Exit criteria:

- CI is green from a clean clone with no unpublished local files.
- No critical/high dependency or secret-scanning findings remain unexplained.
- Hardware bench evidence covers every MQTT command and authoritative state/error response used by Command Center.
- The release tag builds reproducibly, includes checksums or immutable image identifiers, and references the compatible CE firmware version.
- The repository has no bench credentials, local databases, environment secrets, generated build output, or obsolete generic MQTT path.

## Acceptance criteria

- [x] AC-01: Command Center runs from Docker Compose on Windows, macOS, and Linux across ARM64 and AMD64 without Raspberry Pi-specific application code.
- [x] AC-02: First-run admin setup, login, session renewal, logout, and credential changes work entirely through the UI.
- [x] AC-03: Browser code has no MQTT client, generic publish API, bearer token storage, or firmware HTTP time dependency.
- [x] AC-04: Valid retained CE presence, outlet, and schedule state rebuilds the authoritative device mirror after restart.
- [x] AC-05: Firmware-owned outlet assignment and labels drive setup review, template preflight, and full replacement writes.
- [x] AC-06: Templates are assignment-based, revisioned, portable, and compiled to valid CE v3 physical schedules.
- [x] AC-07: Schedule loads establish expectation only after newer matching firmware state.
- [x] AC-08: Firmware-local schedule and outlet changes remain authoritative and produce the documented drift/setup-review behavior.
- [x] AC-09: Every canonical device action follows the documented no-op, pending, confirmation, rejection, timeout, interruption, and blocked contracts.
- [x] AC-10: AUTO/MANUAL switching, per-outlet control, Emergency all-off, Return to AUTO, time sync, and Pump Run Now work without optimistic UI state.
- [x] AC-11: Action history and device events remain separate, bounded, immutable, and available through stable activity pagination.
- [x] AC-12: Missing retained state, broker outages, server restart, device offline, warnings, and drift have distinct typed UI states and remediation.
- [x] AC-13: Diagnostics and exports provide enough current contract evidence without leaking credentials, sessions, CSRF values, raw auth data, or unrestricted MQTT controls.
- [x] AC-14: Update, backup, restore, and reset workflows preserve or intentionally replace state exactly as documented.
- [x] AC-15: Automated checks plus CE hardware bench tests pass before the first public release.
- [x] AC-16: Public repository metadata, license, security guidance, release workflow, and installation documentation are complete.
- [x] AC-17: Release notes identify the bench-tested CE firmware version, and unsupported or incomplete device contracts cannot enter dependent control or schedule workflows.

## Test strategy

### Unit

- Normalize and fingerprint outlet/schedule state independent of ordering, formatting, source, and timestamps.
- Validate CE payloads, template roles, condition ranges, assignment compatibility, labels, API action input, and warning-set identity.
- Exercise preflight blockers/warnings, role inference, CE v3 compilation, drift reasons, action conflicts, and error normalization.
- Test auth validators, password hashing upgrades, CSRF, rate-limit windows/capacity, trusted-proxy parsing, and redaction.

### Server integration

- Run numbered migrations and local-action transactions against temporary SQLite databases.
- Use a real Mosquitto test service plus scripted CE clients to publish retained state and errors at controlled times.
- Cover post-handoff revisions, PUBACK uncertainty, timeout, restart recovery, emergency supersession, late state, and duplicate retained payloads.
- Verify health, shutdown, app-data lock, action/history/activity pagination, diagnostics export, and retention pruning.

### Frontend and browser

- Test setup/login/session/CSRF recovery, onboarding, Device setup, schedule preflight, warning remediation, pending actions, manual controls, drift reconciliation, and outage recovery.
- Run desktop and mobile browser flows with screenshot and console-error checks.
- Run accessibility automation and focused manual keyboard/screen-reader checks on setup, inline detail regions, forms, warnings, and device controls.

### Deployment and security

- Build from a clean clone and run the production Compose stack with fresh volumes.
- Rehearse update, backup, restore, reset, failed migration, second-process lock, graceful stop, broker restart, and host restart.
- Run dependency audit, secret scanning, production-header/cookie checks, CORS/CSRF abuse cases, auth rate-limit tests, and diagnostics redaction tests.

### CE hardware bench

- Verify retained online/offline, outlet state/config/error, schedule state/grow/error, time action/error, mode/relay/error, Pump Run Now, QoS, retained flags, reboot persistence, and reconnect replay.
- Verify label-only changes preserve schedules, assignment changes clear affected entries, AUTO reevaluates outputs, MANUAL preserves outputs, and invalid writes are atomic.
- Record firmware version, Command Center commit, broker version, test procedure, and observed payloads in the release evidence.

## Target verification commands

The repository provides these verification commands:

```bash
npm ci
npm ci --prefix deploy/server
npm run lint
npm run test
npm run test:integration
npm run build
npm run test:e2e:smoke
npm run test:e2e
npm run test:a11y
npm run security
docker compose -f deploy/compose.yml config
docker compose -f deploy/compose.yml up -d --build
```

## Explicitly deferred

- Cloud accounts, multi-user roles, internet-hosted control, and built-in TLS.
- Browser MQTT, generic MQTT publishing, arbitrary topic roots, and broker-wide topic exploration.
- Remote timezone, time-source, SNTP-server, sensor-calibration, and firmware-OTA editing until CE publishes authoritative retained state/error acknowledgements for those workflows.
- Horizontal API scaling, network-shared SQLite/app data, and multi-host active instances.
- Bulk fleet schedule deployment, partial schedule loads, remote clear schedule, and updating an existing template from drifted device state.
- Automatic state-changing retries, automatic template rollout, and HTTP idempotency-key retention.
- Full historical raw MQTT payload storage and a full audit/compliance log.
