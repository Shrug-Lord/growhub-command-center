# Operations

Docker Compose is the supported first-ship deployment on Windows, macOS, and
Linux, including Raspberry Pi. The images support AMD64 and ARM64; a Raspberry
Pi is not required.

For a first deployment, including prerequisite installation, host addressing,
administrator setup, CE device connection, verification, and troubleshooting,
start with the [installation guide](INSTALL.md). This document covers ongoing
administration after Command Center is running.

## Requirements

- Git
- Node.js 24 LTS with npm 11 or newer
- Docker Desktop, or Docker Engine with the Compose plugin

Verify them from PowerShell, Terminal, or a shell:

```bash
git --version
node --version
npm --version
docker version
docker compose version
```

## Install

```bash
git clone https://github.com/Shrug-Lord/growhub-command-center.git
cd growhub-command-center
npm run compose:up
```

The image build installs locked dependencies and builds the UI inside the
server image. It starts one Command Center server, SQLite in a named volume,
and a persistent Mosquitto broker.

Open `http://growhub.local` when the Docker host is named `growhub` and your
network resolves local hostnames. Local-name discovery varies by operating
system and router, so `http://<host-ip>` is the reliable fallback. Open
`http://localhost` from the Docker host itself. First-run administrator setup
is completed entirely in the UI.

Check deployment state without opening the UI:

```bash
docker compose -f deploy/compose.yml ps
docker compose -f deploy/compose.yml logs --tail=200 server
docker compose -f deploy/compose.yml logs --tail=200 mosquitto
```

`GET /health/live` checks the HTTP process. `GET /health/ready` verifies that
configuration, app-data ownership, migrations, and SQLite startup completed.
MQTT outages are shown separately in authenticated diagnostics.

## Sensor History

Command Center stores individual sensor readings for the number of days set in
Settings. History requests support up to 180 days and return no more than 1,000
time-ordered samples. Longer views are time-bucket averages; the dashboard
states how many original readings they represent. This bound keeps week and
all-history views responsive on a Raspberry Pi and in slower browsers without
changing the readings retained in SQLite.

History loading is isolated from the whole-application availability monitor. A
history timeout appears beside the chart with a retry action, while controller
status, schedules, and controls remain usable. Changing ranges cancels the
previous history request. Background device and activity polling pauses while
the page is hidden and refreshes when it becomes visible again.

## Dashboard and grow journal

The selected sensor-history range refreshes with visible-device polling. The
Temperature and Humidity range cards show actual low/high readings and their span,
not the low/high of averaged chart points. Temperature follows the selected C/F
unit. A failed refresh leaves the prior chart visible with a retry option.

Use **Open device management** to open the controller's local page in a new tab.
Firmware with the optional network-state extension reports its current address
automatically over MQTT. Older firmware remains usable and shows an explanatory
unavailable state. For an offline device, the link is labeled as its last reported
address; reachability is not assumed.

The lower dashboard reads Sensor history → Grow journal → Recent activity →
History samples. Section headings toggle their contents and remember the choice
per device in this browser. History samples starts collapsed; other sections start
expanded. Device control always stays expanded.

Choose **Start grow** to record a name, initial phase, and actual start time. Each
device has one active grow; ended grows remain selectable. Phase changes can skip
or revisit phases and can use custom names. Days/Weeks changes only the duration
display (for example, 17 days becomes 2 weeks 3 days); dates remain visible.
**End grow** explicitly freezes the grow and final phase at its end time without
changing device control. Logging Harvest does not end the grow.

Use the quick-add buttons for notes, nutrients, pH adjustments, or training.
Filtering entries leaves timeline totals unchanged. Entries can be corrected in
active and ended grows. Existing entries are available under **Unassigned entries**;
select them and assign them to a same-device grow whose dates cover them.

After a confirmed first/different schedule load, an optional follow-up offers
**Log phase change / Keep current phase**, or **Start grow / Not now** when no grow
is active. The follow-up also appears when loading from the Schedules page and
survives page reloads. Reloading/revising the same template does not prompt. All
load attempts show their actual outcome in Recent activity, along with device
presence and address changes. Operational activity does not clutter the journal.

## Ports and Hostname

The defaults are host port 80 for the UI/API and host port 1883 for CE firmware
MQTT. If port 80 is occupied, copy `deploy/.env.example` to `deploy/.env` and
change the UI port:

```dotenv
GROWHUB_HTTP_PORT=8080
```

Then use `http://growhub.local:8080` or `http://<host-ip>:8080`.

Configure each CE firmware device to use the Command Center host name or LAN IP
as its MQTT broker on port 1883. The browser never connects to MQTT directly.
The bundled broker is anonymous because CE 1.1.0C does not support MQTT broker
credentials. Keep port 1883 on a trusted LAN and never forward it from an
internet router.

## Update

Command Center 0.2.0 defaults periodic release checking to off. Enable **Check
for updates every six hours** to check after startup and every six hours with up
to one minute of randomized delay. **Check now** works even when that setting is
off. Only newer published stable releases are offered.

Prompts offer **Update**, **Later** (24 hours), and **Skip this version**. Skipping
hides the prompt for that tag but keeps the release available in Settings. Update
requires a final confirmation of the exact version and restart impact. The old
unattended-install option is removed; migration disables it for existing installs.

Device cards expose firmware updates through the controller's own check state
and settings. The same controls remain available in the device management page.
Firmware updates briefly interrupt outlet control; a Command Center self-update
interrupts the dashboard/logging while controllers continue operating.

### One-time Linux or Raspberry Pi setup

User-confirmed installation runs outside the web container so the
application never receives the Docker socket or arbitrary host-command access.
From the Command Center checkout, install its narrow systemd host service once:

```bash
sudo "$(command -v node)" scripts/install-update-agent.js
```

The service watches only `deploy/update/request.json`, independently verifies
that its exact `vX.Y.Z` tag is a published stable release, and invokes the
backup-first updater as the account that owns the checkout. After this setup,
use **Update** in the prompt or install from Settings, then confirm the restart.
Routine releases then require no SSH or terminal work. Windows/macOS use the
command-line fallback below; the host service requires Linux/systemd. The server may be unavailable for several minutes while a small Pi builds
and restarts the release.

Inspect host-agent activity when troubleshooting:

```bash
systemctl status growhub-command-center-updater.path
journalctl -u growhub-command-center-updater.service -n 100 --no-pager
```

Failed installations stop without automatic retries. The host script preserves
its pre-update backup, reports the failure, and requires an operator to inspect
logs before retrying or explicitly restoring a backup. It does not automatically
restore older journal data. A request is claimed once before validation and is
not replayed after a failed/interrupted run. Success requires service readiness
and a matching running server version.

### Command-line fallback

The fallback updater requires a clean Git checkout. Supply the exact release
tag shown in GitHub or the UI; it creates a backup first, checks out that tag,
reinstalls locked tooling, pulls service images, rebuilds Command Center,
starts the stack, and waits for readiness:

```bash
npm run compose:update -- --release v0.2.0
```

Pre-update archives are written under `backups/pre-update/`. The command stops
if local source changes are present or Git cannot fast-forward. It never resets
or overwrites local source changes. `--skip-backup` exists for recovery cases,
but is not the normal update path:

```bash
npm run compose:update -- --release v0.2.0 --skip-backup
```

Running `npm run compose:update` without `--release` remains the explicit
source-checkout/development path that fast-forwards the current branch. It is
not used by the UI updater.

## Backup

Create a timestamped restore archive:

```bash
npm run compose:backup
```

The command briefly stops Command Center and Mosquitto so SQLite, the persistent
session secret, and retained MQTT state are mutually consistent. It restarts
only the services that were running. The archive is stored under `backups/` and
contains a versioned manifest, SHA-256 checksums, the complete server-data
volume, and the complete bundled-broker volume.

Choose another destination when the backup must live off the Docker host:

```bash
npm run compose:backup -- --output /path/to/backups
```

A diagnostics JSON export is not a restore backup. It intentionally contains
troubleshooting evidence but no SQLite database, session secret, or broker
persistence database.

## Restore

Restore overwrites both current named volumes. It validates archive paths,
format, and checksums before stopping services, and creates a pre-restore safety
backup by default:

```bash
npm run compose:restore -- backups/growhub-backup-YYYY-MM-DD_HH-MM-SS.tar.gz --yes
```

The restored stack is started and checked for readiness before the command
returns. If restore fails after replacement begins, leave the services stopped,
inspect the reported error, and restore the safety archive from
`backups/pre-restore/`. The advanced `--skip-safety-backup` flag should be used
only when current volumes are known to be unusable.

## Reset

The development/credential-recovery reset removes only Command Center app data,
including the database, admin credential, sessions, and persistent session
secret. It deliberately preserves Mosquitto retained state so CE devices can
repopulate the new mirror:

```bash
npm run compose:backup
npm run compose:reset -- --yes
```

The reset refuses to run without `--yes`. Afterward, open the UI and complete
first-run administrator setup again.

## External Broker

An external MQTT broker is an advanced deployment option for an existing home
automation or managed MQTT installation. It can centralize broker monitoring,
TLS, credentials, or network routing, but it also moves availability,
persistence, access control, and backup responsibility outside Command Center.
Most installations should keep the bundled broker.

Set `MQTT_URL` and a broker-unique `MQTT_CLIENT_ID` in ignored
`deploy/.env`. Credentials embedded in `MQTT_URL` are accepted but never shown
in diagnostics or logs. The bundled broker still starts under the reference
Compose file but is not used by the server. Command Center backup archives cover
only the bundled broker; external retained state must be backed up and restored
using that broker's own procedure.

## Remote Access

Plain HTTP is supported on a trusted local network. For access away from home,
use a VPN into the LAN. An HTTPS reverse proxy is also possible, but it must
forward to the single Command Center server and must not expose MQTT publicly.
Configure `TRUSTED_PROXIES` only with the exact proxy IP/CIDR entries you control.
Do not expose port 80 or 1883 directly to the internet.
