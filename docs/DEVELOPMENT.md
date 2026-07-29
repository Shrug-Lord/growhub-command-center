# Development

Growhub Command Center supports source development on Windows, macOS, and
Linux on ARM64 or AMD64. A Raspberry Pi is one supported Linux host, not a
requirement.

## Prerequisites

- Git
- Node.js 24 LTS and npm 11 or newer
- Docker with the Docker Compose plugin

Use the official installers for [Node.js](https://nodejs.org/en/download) and
[Docker Desktop on Windows](https://docs.docker.com/desktop/setup/install/windows-install/),
[Docker Desktop on macOS](https://docs.docker.com/desktop/setup/install/mac-install/),
or [Docker Desktop on Linux](https://docs.docker.com/desktop/setup/install/linux/).
A Linux server can use [Docker Engine](https://docs.docker.com/engine/install/)
with the Compose plugin instead of Docker Desktop.

Docker is not required to work on the frontend alone. It is the standard way
to run the bundled MQTT broker and reference application stack.

Verify the tools before setup:

```bash
node --version
npm --version
docker version
docker compose version
```

The repository pins Node in `.node-version`. Use Node 24 when your version
manager does not read that file automatically.

## First Setup

Install the locked frontend and server dependencies from the repository root:

```bash
npm run setup
```

## Docker Workflow

Build the self-contained server/UI image and start the bundled server and MQTT
broker:

```bash
npm run compose:up
```

Open `http://localhost`. The stack publishes the UI on host port 80 and plain
MQTT for CE firmware on 1883. It does not expose a browser MQTT/WebSocket port;
the browser reads the server-owned device mirror over authenticated HTTP.
`http://growhub.local` also works when that name resolves to the Docker host on
the local network.

Runtime probes are available at `http://localhost/health/live` and
`http://localhost/health/ready`. Liveness reports that the process can answer;
readiness becomes available only after validated startup and SQLite
app-data ownership, migrations, and initialization complete. It becomes
unavailable during shutdown.

Stop the stack without deleting its data volumes:

```bash
npm run compose:down
```

### Development Data Reset

An unversioned bench database is intentionally not upgraded in place. Startup
returns `legacy_schema_requires_reset` and leaves that database untouched. To
reset the Compose-managed Command Center database and persistent session
secret, rebuild the server image, and restart the server at first-run setup:

```bash
npm run compose:reset -- --yes
```

This command does not delete the Mosquitto volume or its retained MQTT state.
It does not run `docker compose down -v`. The `--yes` flag is required because
the Command Center database, its SQLite sidecars, and the persistent session
secret are deleted intentionally. Existing browser sessions become invalid.

For the native server workflow, stop the server and run:

```bash
npm run reset:dev -- --yes
```

The native reset refuses to run while another process owns the app-data
directory and refuses a `DB_PATH` outside `APP_DATA_DIR`.

### Migrations and Ownership

Numbered SQL migrations live in `deploy/server/migrations/` and use the format
`NNN_lowercase_name.sql`. Versions must be contiguous from `001`. Never edit an
applied migration; add the next numbered file. Command Center records each
migration name and SHA-256 checksum and refuses startup if applied history does
not match the running build.

One process owns an app-data directory at a time. Command Center holds an
exclusive transaction on a dedicated rollback-mode SQLite lock database for
the process lifetime, closes the application database first, and releases the
lock last. [SQLite maps file locking to operating-system facilities on Unix and
Windows](https://www.sqlite.org/lockingv3.html); the OS releases ownership when
a process exits or crashes. Keep `APP_DATA_DIR` on a local filesystem.
Network-shared app data is unsupported because SQLite cannot assume reliable
file locking there.

## Live Frontend Workflow

Start the Docker stack, then run Vite in a second terminal:

```bash
npm run compose:up
npm run dev
```

Open `http://localhost:5173`. Vite proxies API requests to the Compose server
at `http://127.0.0.1` by default.

To use an API server at another address, create an ignored `.env.local` file:

```dotenv
GROWHUB_API_TARGET=http://127.0.0.1:3000
```

## Native Server Workflow

The application server can run outside Docker while Mosquitto stays in a
container:

```bash
docker compose -f deploy/compose.yml up -d mosquitto
npm run dev:server
```

The native server listens on port 3000, connects to MQTT at
`mqtt://127.0.0.1:1883`, and stores its development database under
`deploy/server/data/`. Compose overrides those defaults inside the container.
Use the `.env.local` API target above when pairing this workflow with Vite.

## Verification

Run the release-candidate checks:

```bash
npm run lint
npm run format:check
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run test:a11y
npm run security
npm run security:signatures
npm run compose:config
npm run compose:build
npm run test:compose:mqtt
```

The automated suites cover runtime ownership and shutdown, migrations,
authentication and recovery, API contracts, CE topic/payload validation,
authoritative mirrors, action confirmation and conflict behavior, template
preflight and drift, diagnostics redaction, retention, the complete deterministic
operator browser flow, WCAG 2 A/AA automation, mobile overflow, response security
headers, dependency audits/signatures, secret scanning, and the production
container build.

`npm run test:compose:mqtt` requires a fresh running Compose data volume. CI
runs it only against an ephemeral stack; do not point it at an installation
that already contains administrator or device state.

CE hardware, Raspberry Pi ARM64, and macOS ARM64 evidence are recorded in
`docs/release-evidence/`. Public-host CI and the remaining manual release checks
stay gated by `docs/release-evidence/HOST-COMPATIBILITY.md`; follow
`docs/RELEASE.md` before tagging.

### Restart Recovery Smoke Test

With the Compose stack running and the browser signed in, stop only the API
server:

```bash
docker compose -f deploy/compose.yml stop server
```

Navigate to a page that performs a normal read. Confirm that the current page
stays visible and read-only, navigation and page actions are disabled, and the
`Command Center unavailable` banner offers `Retry now` and non-destructive
troubleshooting commands. Start the server again:

```bash
docker compose -f deploy/compose.yml start server
```

Within the next five-second readiness probe, the banner should clear only after
session validation and current-page refresh complete. The browser must stay on
the same page, controls must re-enable, and no prior state-changing request may
be replayed.
