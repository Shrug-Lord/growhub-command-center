# Raspberry Pi ARM64 Docker Host Evidence

Status: passed

- Tested at: 2026-07-27 through 2026-07-28 EDT
- Tested by: project maintainer with Codex-assisted execution
- Host: Raspberry Pi 3 Model B Rev 1.2
- Architecture: Linux ARM64 (`aarch64`)
- OS: Debian GNU/Linux 13.5 (Trixie), freshly imaged in 64-bit mode
- Memory: 905 MiB RAM and 904 MiB swap
- Storage: 29 GiB root filesystem with 22 GiB available before deployment
- Node.js/npm: 24.18.0 / 11.16.0
- Docker Engine/Compose: 29.6.2 / 5.3.1
- Command Center version: 0.1.0
- Command Center commit: recorded by the follow-up publication evidence commit
- CE device: Growhub+ running firmware 1.1.0C

## Exact Source

The unpublished release-candidate history was transferred as a Git bundle
containing only `main`, then cloned on the Pi. The bundle SHA-256 was
`79edf97499cd4009d2c9d0e784b1813f342a4a08c9298ea96b6a733d9f9cc2a0`.
The clean clone resolved to the commit above with no modified or untracked
files. Public-host CI remains a separate unchecked gate because the repository
did not yet have a public remote.

## Procedure and Results

1. Recorded the Pi model, ARM64 architecture, OS, RAM, swap, and storage.
2. Installed the repository-pinned Node.js/npm toolchain and the official
   Docker Engine and Compose plugin packages for Debian ARM64.
3. Verified non-root Docker access by pulling and running the ARM64
   `hello-world` image.
4. Cloned the exact release history from the checksummed bundle.
5. Ran the locked dependency setup and complete non-browser verification gate.
   Lint, formatting, unit, integration, production build, secret scan, and both
   dependency audits passed. Both audits reported zero vulnerabilities.
6. Verified registry signatures for 249 frontend packages and 147 server
   packages. Published attestations also verified.
7. Validated the Compose configuration and built the production ARM64 image on
   the 1 GiB-class Pi without an out-of-memory failure.
8. Started fresh application and Mosquitto volumes with the documented command.
   Liveness reported setup required and readiness reported ready.
9. Completed first-run administrator setup entirely in the browser UI.
10. Pointed one CE 1.1.0C Growhub+ at the bundled broker. Command Center
    discovered it automatically, marked it online and ready, showed compatible
    firmware and outlet state, and received updating live telemetry.
11. Ran the documented stop/start workflow. The Growhub remained locally
    operational, indicated MQTT loss, and reconnected automatically. The
    administrator and device state remained intact.
12. Rebooted the complete Pi host. Docker started both services automatically;
    the server returned healthy/ready, the administrator state persisted, and
    the Growhub returned online and ready with live telemetry.
13. Created a consistent backup of both volumes. The archive contained only
    `manifest.json`, `server-data.tar.gz`, and `mosquitto-data.tar.gz`. Its
    SHA-256 was
    `9d75611a0480603e8d956edbdc8cd831b8f5ee0dd00e7f1bf73c860ba1f7f98f`.
    A second copy transferred off the Pi produced the same checksum.
14. Removed both containers, the Compose network, and both named data volumes.
    A fresh restart returned to first-run setup while the CE device reconnected
    autonomously to the new broker.
15. Restored the verified archive with the documented command. Archive paths
    and internal manifest checksums validated before replacement. The original
    administrator, compatible/ready device mirror, outlet state, broker
    connectivity, and live telemetry returned.
16. Staged the Pi-only checkout at an earlier pre-publication candidate,
    tracking the bundle's current `main`, then ran the documented updater. It
    created the pre-update backup before fast-forwarding to the then-current
    pre-publication candidate, reinstalled locked dependencies,
    pulled pinned images, rebuilt the ARM64 server image, restarted services,
    and waited for readiness. The pre-update backup SHA-256 was
    `ad8402c72a17892ab111a4e2697fd504a3b2b2ccfeb4b1b25acb4abbbcf73eca`.
17. Confirmed the post-update checkout was clean at the exact candidate commit,
    both services were running, readiness was healthy, the UI retained the
    administrator, and the Growhub was online/ready with live telemetry and a
    solid operation LED.
18. Returned the Pi checkout to `main` and removed the fully merged temporary
    rehearsal branch.

The host's `.local` name did not resolve from the bench Mac. The documented
numeric LAN-address fallback loaded the UI successfully. This is expected
host/network behavior because Command Center does not provide mDNS advertising.
No application change was required.

The locked server dependency tree emitted the upstream
`prebuild-install@7.1.3` deprecation notice through `better-sqlite3@12.11.1`.
Installation, native ARM64 execution, tests, build, signatures, and zero-finding
security audits all passed; the notice did not block this release evidence.

## Commands

```sh
uname -m
cat /proc/device-tree/model
cat /etc/os-release
free -h
df -h /
node --version
npm --version
docker version
docker compose version
docker run --rm hello-world
git clone --branch main "$HOME/Growhub-Command-Center-main.bundle" "$HOME/growhub-command-center"
git status --short --branch
git rev-parse HEAD
npm run setup
npm run verify
npm run security:signatures
npm run compose:config
npm run compose:build
npm run compose:up
docker compose -f deploy/compose.yml ps
curl --fail --silent --show-error http://127.0.0.1/health/live
curl --fail --silent --show-error http://127.0.0.1/health/ready
npm run compose:down
npm run compose:up
sudo reboot
npm run compose:backup
sha256sum backups/growhub-backup-2026-07-28_11-03-16-258Z.tar.gz
tar -tzf backups/growhub-backup-2026-07-28_11-03-16-258Z.tar.gz
docker compose -f deploy/compose.yml down -v --remove-orphans
npm run compose:up
npm run compose:restore -- backups/growhub-backup-2026-07-28_11-03-16-258Z.tar.gz --yes
git switch -c update-rehearsal "$EARLIER_CANDIDATE_COMMIT"
git branch --set-upstream-to=origin/main update-rehearsal
npm run compose:update
git switch main
git branch -d update-rehearsal
```

## Acceptance Mapping

- Host compatibility, AC-01: passed on Linux ARM64 with generic Compose and no
  Raspberry Pi-specific application code.
- Clean documented deployment: passed from an exact, checksummed Git history.
- UI-only first run: passed.
- Real CE discovery/readiness: passed against firmware 1.1.0C.
- Stop/start and full-host reboot persistence: passed.
- Backup-before-update ordering: passed with a real two-commit fast-forward.
- Destructive replacement and two-volume restore: passed.
- LAN UI reachability: passed through the documented numeric-address fallback.
