# Host Compatibility Evidence

Status: pending

- Command Center commit: recorded by the follow-up publication evidence commit
- Reference Raspberry Pi: passed
- Docker Engine/Compose: 29.6.2 / 5.3.1 on Linux ARM64
- Tested by: project maintainer with Codex-assisted execution
- Tested at: 2026-07-27 through 2026-07-28 EDT
- Reference record: `docs/release-evidence/HOST-raspberry-pi-arm64-2026-07-28.md`

## Clean Release Checkout

- [ ] Linux x64 quality and production Compose jobs pass in public CI.
- [ ] macOS ARM64 package install, tests, and production build pass in public CI.
- [ ] Windows x64 package install, tests, and production build pass in public CI.
- [ ] The release image builds for Linux AMD64 and Linux ARM64.

## Reference Raspberry Pi

- [x] A clean checkout builds and starts with the documented Compose commands.
- [x] First-run administrator setup completes entirely in the UI.
- [x] A CE device is discovered through the bundled broker and becomes ready.
- [x] Stop/start and host reboot preserve application and retained broker state.
- [x] Update creates a backup before changing the checkout or image.
- [x] Backup, destructive data replacement, and restore reproduce both data volumes.
- [x] The UI is reachable through `http://growhub.local` or the documented host fallback.

## Non-Pi Host

- [x] Repeat the isolated install/backup/restore rehearsal from the clean release checkout.
- [x] Link the completed host record and note any Docker Desktop or host-specific behavior.

## Supporting Evidence

- macOS ARM64 pre-publication and clean-checkout rehearsals:
  `docs/release-evidence/HOST-macos-arm64-2026-07-13.md`
- Raspberry Pi 3 ARM64 clean-checkout rehearsal:
  `docs/release-evidence/HOST-raspberry-pi-arm64-2026-07-28.md`
