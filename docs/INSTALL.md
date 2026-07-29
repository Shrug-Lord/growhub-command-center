# Install Growhub Command Center

This guide installs Growhub Command Center on a Windows, macOS, or Linux host,
including a 64-bit Raspberry Pi. The application commands are the same on every
platform; only prerequisite installation differs.

> **Release-candidate note:** Raspberry Pi ARM64 and macOS ARM64 deployments
> have passed clean-host rehearsals. The same Compose contract targets Linux
> AMD64 and Windows hosts, but those public CI results will be recorded after the
> repository is published. Platform-specific notes will be added here if that
> verification finds any differences.

Command Center is a local companion for NIWA Growhub controllers running Growhub
CE firmware. The controllers remain responsible for their active schedules and
relay outputs when Command Center, its MQTT broker, or the host is unavailable.

## Before You Start

You need:

- One or more Growhub controllers running CE firmware `1.1.0C`
- A 64-bit AMD64 or ARM64 computer on the same trusted network
- Git
- Node.js 24 LTS with npm 11 or newer
- Docker Desktop, or Docker Engine with the Docker Compose plugin
- Permission to reserve or otherwise keep a stable LAN address for the host

A Raspberry Pi 3 Model B with a 64-bit operating system and approximately 1 GB
of RAM passed the reference deployment test. Faster hardware improves build and
update time but is not required for normal operation.

Command Center uses plain HTTP and anonymous MQTT on the trusted local network.
Do not forward its HTTP or MQTT ports from your internet router. See
[Security Boundary](#security-boundary) before enabling remote access.

## 1. Install The Prerequisites

Use the official installers for your platform:

- [Git downloads](https://git-scm.com/downloads/)
- [Node.js downloads](https://nodejs.org/en/download) — select Node.js 24 LTS
- [Docker Compose installation overview](https://docs.docker.com/compose/install/)

Docker Desktop includes Docker Engine, the Docker CLI, and Docker Compose. It is
the simplest option on Windows and macOS and is also available for desktop
Linux. A headless Linux server or Raspberry Pi should normally use
[Docker Engine](https://docs.docker.com/engine/install/) with the Compose plugin.

On Windows, configure Docker Desktop to run Linux containers. On Linux, if the
Docker commands below report a socket permission error, follow Docker's
[Linux post-installation guidance](https://docs.docker.com/engine/install/linux-postinstall/)
instead of running the complete Command Center workflow as root.

Open PowerShell, Terminal, or a shell and verify every prerequisite:

```text
git --version
node --version
npm --version
docker version
docker compose version
```

Expected results:

- `node --version` starts with `v24.`
- `npm --version` is 11 or newer
- `docker version` shows both Client and Server information
- `docker compose version` succeeds with a space between `docker` and `compose`

If `docker version` shows only client information or cannot connect to the
daemon, start Docker Desktop or the Docker Engine service before continuing.
The legacy `docker-compose` standalone command is not the supported path.

## 2. Choose A Stable Host Address

Every Growhub must be able to reach the Command Center host on your local
network. Before connecting devices:

1. Find the host's LAN address in its network settings or your router's client
   list.
2. Reserve that address for the host in your router when possible.
3. Confirm the host and Growhub controllers are on the same network, or on
   routed networks that permit local HTTP and MQTT traffic.

Examples in this guide use `<host-ip>` as a placeholder. Replace it with the
real LAN address of your Command Center host; do not type the angle brackets.

`http://localhost` works only from the Command Center host itself. A local name
such as `http://growhub.local` works only when your host and network already
provide local-name discovery. Command Center does not advertise an mDNS name,
so the numeric LAN address is the reliable fallback.

## 3. Download And Start Command Center

Run these commands from the directory where you want to keep the application:

```text
git clone https://github.com/Shrug-Lord/growhub-command-center.git
cd growhub-command-center
npm run compose:up
```

The first build downloads the pinned container images and locked dependencies,
then creates two services:

- `server` — the web UI, authenticated API, and persistent SQLite data
- `mosquitto` — the local MQTT broker and retained device state

The initial build may take several minutes on a small Raspberry Pi. Do not close
the terminal until the command finishes.

Check the services:

```text
docker compose -f deploy/compose.yml ps
```

Both services should show `Up`; the server should become `healthy`. You can also
open this address in a browser on the host:

```text
http://localhost/health/ready
```

A ready installation returns:

```json
{"status":"ready"}
```

### If Port 80 Or 1883 Is Already Used

The defaults are:

- HTTP/UI: host port `80`
- MQTT: host port `1883`

Before starting Command Center, create a plain-text file named `deploy/.env` to
override either port:

```dotenv
GROWHUB_HTTP_PORT=8080
GROWHUB_MQTT_PORT=1884
```

Only change the port that conflicts. If you change the HTTP port, include it in
the browser address, such as `http://<host-ip>:8080`. If you change the MQTT
port, enter the same new port in every Growhub's Command Center settings.
`deploy/.env` is intentionally ignored by Git.

## 4. Create The Administrator

Open Command Center in a browser:

- On the host: `http://localhost`
- From another device: `http://<host-ip>`
- With an HTTP override: `http://<host-ip>:<http-port>`

The first visit opens **Create the local administrator**.

1. Choose an administrator username and a strong, unique password.
2. Submit the setup form.
3. Sign in with the credential you just created.

There is no default administrator password and no configuration-file
credential. The administrator, sessions, and persistent session secret are
stored in Command Center's Docker data volume.

An empty dashboard is normal until a CE device connects to the bundled broker.

## 5. Connect A Growhub CE Device

Repeat these steps for each Growhub:

1. Open the Growhub CE firmware page using the device's LAN address.
2. Find the **Command Center** section.
3. Enter the Command Center host's LAN address in **Server address**. Enter only
   the address or resolvable host name—do not include `http://` or a path.
4. Leave **Port** at `1883`, unless you set `GROWHUB_MQTT_PORT` to another value.
5. Select **Save**. If the device was previously disconnected from Command
   Center, select **Reconnect CC**.

The firmware status should change to **Command Center: Connected** and
**Mirroring**. Command Center automatically discovers compatible devices; no
device ID or MAC address needs to be entered manually.

When the device appears in Command Center:

1. Open it from the dashboard.
2. Review its firmware-owned outlet assignments and labels under **Device
   setup**.
3. Correct the assignments in Command Center if needed; accepted changes are
   written back to firmware as a complete four-outlet configuration.
4. Select **Confirm current setup**.

The device should show **Online**, **Device state ready**, and live sensor data.
An original Growhub and a Growhub+ use the same Command Center workflow.

## 6. Verify The Installation

Confirm all of the following before relying on Command Center:

- The dashboard shows **Broker online**.
- Every connected Growhub shows **Online** and **Device state ready**.
- Sensor readings update.
- Outlet assignments and labels match the physical controller.
- The firmware page reports Command Center connected and mirroring.

Then verify a normal application restart:

```text
npm run compose:down
npm run compose:up
```

Sign in again and confirm that the administrator and devices are still present.
The Growhubs continue their local schedules while Command Center is stopped and
reconnect automatically after the broker returns.

For an always-on installation, also reboot the host once. Make sure Docker
starts after the reboot, then confirm:

```text
docker compose -f deploy/compose.yml ps
```

Finally, create an initial backup:

```text
npm run compose:backup
```

Move a copy of the resulting archive in `backups/` somewhere outside the
Command Center host. Backup archives contain the administrator verifier,
sessions, persistent session secret, device mirror, schedules, and retained
MQTT state; treat them as sensitive.

## Troubleshooting

### The Command Center Page Does Not Open

Run:

```text
docker compose -f deploy/compose.yml ps
docker compose -f deploy/compose.yml logs --tail=200 server
```

- If the server is not healthy, inspect the latest server log error.
- If `localhost` works but another computer cannot connect, use the host's LAN
  address and allow the configured HTTP port through the host firewall for the
  trusted local network.
- If a `.local` address fails, use the numeric LAN address.
- If the log reports that a port is already allocated, configure an override in
  `deploy/.env` and restart.

### Docker Cannot Start The Services

- Make sure Docker Desktop or Docker Engine is running.
- Confirm `docker version` shows Server information.
- Confirm `docker compose version` succeeds.
- On Linux, resolve Docker socket permissions using the official post-install
  instructions linked above.
- On Windows, confirm Docker Desktop is using Linux containers.

### A Growhub Does Not Appear

- Confirm the firmware is CE `1.1.0C`.
- Confirm the firmware's **Server address** is the Command Center host, not the
  Growhub's own address and not `localhost`.
- Confirm the firmware port matches `GROWHUB_MQTT_PORT`, normally `1883`.
- Check the firmware page for **Connected** and **Mirroring**.
- Allow the MQTT port through the host firewall for the trusted local network.
- Disable WiFi client isolation or guest-network isolation between the host and
  Growhub.
- Inspect broker and server logs:

  ```text
  docker compose -f deploy/compose.yml logs --tail=200 mosquitto
  docker compose -f deploy/compose.yml logs --tail=200 server
  ```

### A Device Shows Setup Or Contract Warnings

- **Setup needs review** means Command Center has not yet confirmed the current
  firmware-owned outlet configuration. Review it and select **Confirm current
  setup**.
- **Firmware contract needs attention** means required CE MQTT state is missing
  or incompatible. Confirm the device runs CE `1.1.0C`, is connected to the
  correct broker, and has republished outlet and schedule state after reconnect.
- **Syncing retained state** can appear briefly after Command Center or the
  broker restarts. If it persists, check the MQTT connection and logs.

## Next Steps

See [Operations](OPERATIONS.md) for:

- Updates with an automatic pre-update backup
- Backup and checksum-validated restore
- Administrator credential recovery and reset
- Port and logging configuration
- External broker ownership
- VPN and reverse-proxy guidance

See [Growhub CE firmware installation](https://github.com/Shrug-Lord/Growhub-CE-Firmware/blob/main/docs/INSTALL.md)
if a controller is still running stock NIWA firmware.

## Security Boundary

The default deployment is intended for a trusted local network. It uses plain
HTTP and anonymous MQTT because CE `1.1.0C` does not support MQTT broker
credentials.

- Do not forward the HTTP or MQTT ports from an internet router.
- Do not put the host or Growhubs on an untrusted public network.
- Use a VPN for remote access.
- Keep `deploy/.env`, `backups/`, diagnostics exports, and Docker data private.
- Use an HTTPS reverse proxy only if you understand and configure the trusted
  proxy boundary described in [Operations](OPERATIONS.md#remote-access).
