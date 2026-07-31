# Changelog

All notable changes will be documented here.

## [Unreleased]

### Added

- Firmware-authoritative CE device discovery and retained-state mirroring
- UI-only first-run admin setup with server-side sessions and CSRF protection
- Typed, confirmed device actions for schedules, outlet configuration, time,
  AUTO/MANUAL mode, per-outlet control, emergency all-off, and Pump Run Now
- Assignment-based schedule templates with revisions, preflight, expectations,
  and explicit drift recovery
- Authenticated redacted diagnostics and deterministic operator workflows
- Cross-platform Docker Compose deployment with backup, restore, update, and
  development reset operations
- Automated unit, integration, browser, accessibility, security, and container
  release gates

### Fixed

- Added an explicit Growhub favicon to the application shell and production
  container so browser tabs no longer display a missing-icon warning.

### Compatibility

- Target CE firmware baseline: `1.1.0C`
- CE 1.1.0C hardware compatibility passed on two Growhub+ controllers and one
  original Growhub.
- Raspberry Pi ARM64 and macOS ARM64 clean-host deployment rehearsals passed.
- The first tag remains pending public-host CI, multi-architecture image build,
  and the focused manual keyboard/screen-reader spot check.
