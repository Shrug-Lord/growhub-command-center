# Growhub Command Center

Local-first control and monitoring for Growhub devices running CE firmware.

## Start Here

- CONTEXT.md defines canonical product language and settled behavior.
- docs/ARCHITECTURE.md describes the implemented system boundaries.
- docs/SHIP-PLAN.md tracks acceptance criteria and release gates.
- docs/adr/ contains the decisions behind firmware and Command Center ownership.
- docs/DEVELOPMENT.md and docs/OPERATIONS.md contain runnable workflows.

When documentation conflicts, use the ADRs and current CE firmware MQTT
contract, then update the stale document in the same change.

## Non-Negotiable Boundaries

- CE firmware owns live outlet assignments and labels, active schedules,
  relay mode and output state, presence, time health, and runtime automation.
- Command Center owns reusable schedule templates and revisions, per-device
  role mappings, expected-schedule links, setup review, action history, and
  diagnostics metadata.
- The browser talks only to the same-origin typed HTTP API. It cannot connect
  to MQTT, choose topics, submit raw payloads, or call firmware HTTP endpoints.
- MQTT actions complete only after newer authoritative firmware state confirms
  the requested result. QoS acknowledgement alone is not success.
- Firmware-local changes remain authoritative. Command Center reports drift
  and offers explicit adoption or reload actions; it never silently mutates a
  template or active device.
- Run one Command Center API process per installation with local SQLite app
  data. Horizontal replicas and network-shared app data are unsupported.
- Docker Compose is the primary Windows, macOS, and Linux deployment on AMD64
  and ARM64. A Raspberry Pi is supported but not required.
- The bundled broker is the first-ship default. External MQTT is advanced and
  remains the operator's availability, access-control, and backup responsibility.

## Current Stack

- React 18 and Vite frontend
- Node.js 24 LTS and Express API
- SQLite via better-sqlite3
- MQTT.js server-owned firmware integration
- Mosquitto 2 in the reference Compose deployment
- Node test runner, ESLint, Prettier, Playwright, and Axe

## Working Commands

- npm run setup
- npm run lint
- npm test
- npm run test:integration
- npm run build
- npm run test:e2e
- npm run security
- npm run compose:config
- npm run compose:up

Use numbered immutable SQL migrations in deploy/server/migrations/. This
project has not shipped a legacy schema, so old bench data is reset rather than
carried through compatibility code.

Do not add bench device identifiers, private LAN addresses, credentials,
runtime databases, environment files, build output, browser MQTT, generic
publish routes, or obsolete recipe/socket terminology to the repository.
