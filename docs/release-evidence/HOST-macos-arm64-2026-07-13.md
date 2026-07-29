# macOS ARM64 Docker Host Evidence

Status: passed

## Clean Release Checkout Repeat

- Tested at: 2026-07-28 EDT
- Host: macOS 26.5.2, Apple ARM64
- Docker Engine: 29.6.1, Linux ARM64 VM
- Docker Compose: 5.3.0
- Node.js/npm: 24.18.0 / 11.16.0
- Command Center version: 0.1.0
- Command Center commit: `e86756e09a7646caf50c0987d3c17833dd8b839e`
- Deployment project: isolated `growhub-nonpi-release`
- HTTP/MQTT test ports: 18082/11885
- Backup SHA-256:
  `ed044cc29c2feac316e7e9da61825f288ad59b55624878be455c81e9d7c14a9b`

The exact clean clone passed locked dependency installation, lint, formatting,
96 server tests, 25 client tests, 26 integration tests, the production build,
secret scanning, and both zero-vulnerability audits. The isolated production
image built as Linux ARM64 and started with fresh application and Mosquitto
volumes. The bundled MQTT smoke test published retained CE presence, outlet,
and schedule documents and confirmed that the authenticated application mirror
became ready.

The backup stopped and restarted only the isolated services, contained exactly
the manifest plus the server and broker archives, and produced the checksum
above. Both isolated volumes were then deleted and recreated; liveness returned
`setup_required: true`. The documented restore validated and replaced both
volumes. Authenticated API verification recovered the original administrator,
online/ready CE mirror, firmware-owned `Canopy Light` label, AUTO mode, and CE
schedule version 3. Direct Mosquitto reads recovered all three retained CE
documents. The isolated project and volumes were removed afterward, and the
normal `deploy` project remained healthy and ready throughout.

Docker Desktop's Linux ARM64 VM is the only host-specific layer observed. The
application, Compose file, backup/restore scripts, and test contract required no
macOS-specific behavior.

Commands for the clean repeat:

```sh
npm run setup
npm run verify
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi-release -f deploy/compose.yml up -d --build
COMPOSE_PROJECT_NAME=growhub-nonpi-release GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 GROWHUB_SMOKE_URL=http://127.0.0.1:18082 npm run test:compose:mqtt
COMPOSE_PROJECT_NAME=growhub-nonpi-release GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 npm run compose:backup -- --output /private/tmp/cc-macos-clean-backups-20260728
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi-release -f deploy/compose.yml down -v --remove-orphans
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi-release -f deploy/compose.yml up -d
COMPOSE_PROJECT_NAME=growhub-nonpi-release GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 npm run compose:restore -- /private/tmp/cc-macos-clean-backups-20260728/growhub-backup-2026-07-28_20-44-01-166Z.tar.gz --yes --skip-safety-backup
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi-release -f deploy/compose.yml down -v --remove-orphans
```

## Earlier Pre-publication Rehearsal

- Tested at: 2026-07-13 EDT / 2026-07-14 UTC
- Host: macOS 26.5, Apple ARM64
- Docker Engine: 29.6.1, Linux ARM64 VM
- Docker Compose: 5.2.0
- Node.js: 24.18.0
- Command Center version: 0.1.0
- Deployment project: isolated `growhub-nonpi`
- HTTP/MQTT test ports: 18082/11885

## Procedure

1. Built and started the production Compose stack with fresh, isolated volumes.
2. Completed UI-equivalent administrator setup through the HTTP API.
3. Published retained CE presence, outlet assignment, and CE v3 schedule state
   through the bundled Mosquitto container.
4. Confirmed the authenticated API rebuilt a ready device mirror.
5. Stopped both data services and created the checksum-manifest backup.
6. Deleted the isolated containers, network, and both named data volumes.
7. Recreated the stack with fresh volumes and confirmed setup was required.
8. Restored the backup with checksum validation and no safety backup because the
   replacement deployment contained only disposable test data.
9. Confirmed the restored administrator login, firmware-owned outlet label,
   ready device mirror, retained broker state, and CE v3 schedule.
10. Removed the isolated project and verified the normal development deployment
    remained healthy.

## Result

The clean install, bundled broker, stateful backup, destructive volume
replacement, and restore workflow passed on an ARM64 non-Raspberry-Pi host. The
release tag should repeat this rehearsal from a clean clone; Windows x64 and
macOS ARM64 package install/test/build are also represented in CI.

## Commands

```sh
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi -f deploy/compose.yml up -d --build
COMPOSE_PROJECT_NAME=growhub-nonpi GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 GROWHUB_SMOKE_URL=http://127.0.0.1:18082 npm run test:compose:mqtt
COMPOSE_PROJECT_NAME=growhub-nonpi GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 node scripts/compose-backup.js --output /tmp/growhub-nonpi-evidence
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi -f deploy/compose.yml down -v --remove-orphans
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi -f deploy/compose.yml up -d
COMPOSE_PROJECT_NAME=growhub-nonpi GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 node scripts/compose-restore.js /tmp/growhub-nonpi-evidence/growhub-backup-2026-07-14_03-32-40-741Z.tar.gz --yes --skip-safety-backup
GROWHUB_HTTP_PORT=18082 GROWHUB_MQTT_PORT=11885 docker compose -p growhub-nonpi -f deploy/compose.yml down -v --remove-orphans
```
