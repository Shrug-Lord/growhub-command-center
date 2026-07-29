# Contributing

Growhub Command Center is still approaching its first public release. Changes
should preserve the firmware/Command Center ownership boundary and use the
canonical language in `CONTEXT.md`.

## Development Setup

Install Node.js 24 LTS, npm 11, Docker, and the Docker Compose plugin, then run:

    npm run setup
    npm run compose:up

Source-development details are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Before Opening a Pull Request

Run:

    npm run lint
    npm run format:check
    npm test
    npm run test:integration
    npm run build
    npm run test:e2e
    npm run security
    npm run compose:config

Add focused tests for changed behavior. Keep API inputs closed and typed, and
do not add browser MQTT, generic publish endpoints, optimistic action success,
automatic state-changing retries, or duplicated firmware-owned state.

## Database Changes

Add the next contiguous numbered SQL file under
`deploy/server/migrations/`. Never edit an applied migration. Legacy bench data
does not require migration compatibility before the first release.

## Documentation

Update the relevant ADR when changing an architectural decision. Update
`CONTEXT.md` when terminology or settled product behavior changes. Update the
ship plan when an acceptance criterion or release gate changes.

## Pull Requests

Keep changes scoped and describe:

- User-visible behavior
- Firmware contract impact
- Persistence or migration impact
- Commands used for verification
- Any remaining hardware or deployment evidence
