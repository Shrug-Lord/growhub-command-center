# Architecture

Growhub Command Center is a local, single-installation control plane for one or
more Growhub controllers running CE firmware. It is designed to keep working on
a trusted LAN without a cloud account.

## Runtime Topology

    Browser
       |
       | same-origin HTTP, cookie session, CSRF on writes
       v
    Command Center server
       |-- React production assets
       |-- Express typed API
       |-- SQLite app data
       |-- one MQTT client
       |
       v
    MQTT broker <----> CE firmware devices

The reference Compose stack runs the server and Mosquitto as separate services.
It publishes HTTP on host port 80 and firmware MQTT on host port 1883. Browser
MQTT and Mosquitto WebSockets are not part of the application path.

## Ownership

CE firmware is authoritative for:

- Presence and current sensor data
- Physical outlet assignments and labels
- Active schedule and schedule warnings
- AUTO/MANUAL mode and physical output state
- Wall-time health and local runtime automation

Command Center is authoritative for:

- Named schedule templates and immutable revisions
- Portable assignment-based roles and per-device mappings
- Expected active schedule links and drift episodes
- Device setup review
- Device action history and bounded device events
- Local admin sessions and diagnostics metadata

Command Center never needs to remain connected for firmware automation to run.

## State and Commands

The server validates a closed CE topic and payload contract before discovery or
mirror mutation. Current raw snapshots are retained only for diagnostics; UI and
action logic use normalized state.

The browser submits closed action types to
`POST /api/v1/devices/:deviceId/actions`. It cannot provide MQTT topics, raw
payloads, QoS, or arbitrary context. MQTT actions are persisted before publish
and become successful only when a newer authoritative firmware state matches
the action predicate. PUBACK is transport evidence, not completion evidence.

Firmware-local changes update the mirror immediately. If an expected schedule
exists and the active firmware schedule differs, Command Center opens one drift
episode and offers explicit choices to reload the expected revision, save the
firmware schedule as a new template, or acknowledge and unlink the expectation.

## Persistence

SQLite stores numbered schema migrations, authentication, mirrors, templates,
mappings, expectations, actions, events, and incidents. A separate persistent
session secret lives in the same app-data volume. An OS-backed lock allows only
one API process to own an app-data directory.

Mosquitto retained state lives in a separate named volume. A valid backup
contains both volumes because restoring only one can produce an inconsistent
view.

Sensor history remains stored as individual firmware readings under the
configured retention policy. Browser range requests are capped at 180 days and
the server groups each response into at most 1,000 time buckets using the
indexed device/time key. Responses identify both the returned bucket count and
the number of original readings represented, so the UI and CSV export can label
averaged history accurately. A history request is an isolated dashboard read:
failure leaves device control and server availability unchanged, and selecting
a new range cancels the older request.

## Release Updates

The server polls only the repository's latest stable tagged GitHub Release and
persists the cached release, per-tag dismissal, and automatic-update preference
in SQLite. It cannot run Docker or arbitrary host commands. On Linux, a
one-time-installed systemd path service watches a narrow bind-mounted request
directory, validates the exact release again, and runs the existing backup-first
Compose updater from the host checkout. This keeps Docker authority outside the
web application while allowing routine Pi updates from the UI.

## Security Boundary

The first release is a local-network appliance, not an internet service:

- First-run admin credentials are created in the UI; there are no defaults.
- Sessions are server-side and cookies are HTTP-only and SameSite.
- Authenticated writes require an in-memory CSRF token.
- The web container has no Docker socket; release installation crosses to the
  host only through a validated stable-tag request file.
- The server applies bounded authentication rate limits and response security
  headers.
- Diagnostics exports redact credentials, session material, CSRF values,
  configured MQTT credentials, client addresses, and the configured username.
- Plain MQTT is exposed only because the current CE baseline has no broker
  credential support. Port 1883 must stay on a trusted LAN.
- Remote access should use a VPN or a correctly configured HTTPS reverse proxy.

## Portability

Application code has no Raspberry Pi dependency. Docker Compose is the primary
deployment on Windows, macOS, and Linux, with Linux AMD64 and ARM64 images.
Native Node development is supported, but the release operations assume local
Docker volumes and one server process.

## Decisions

- [Firmware-owned active schedules](adr/0001-firmware-owned-active-schedules.md)
- [Firmware-owned outlet assignments](adr/0002-firmware-owned-outlet-assignments.md)
- [Assignment-based templates](adr/0003-assignment-based-schedule-templates.md)
- [MQTT device discovery](adr/0004-mqtt-device-auto-discovery.md)
- [Server-owned MQTT integration](adr/0005-server-owned-mqtt-integration.md)

The complete action contract and release acceptance criteria are in
[SHIP-PLAN.md](SHIP-PLAN.md).
