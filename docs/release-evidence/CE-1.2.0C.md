# CE 1.2.0C Command Center Compatibility Evidence

Status: passed

- Command Center version: 0.2.0
- Command Center commit: `d4a84f60ecc190cfa71d653b3ec7d995dbdffe00`
- CE firmware version: 1.2.0C
- CE firmware fix commit: `3322e9490bf6f4dfdb3f26eaadee0d4ef78aa870`
- Exact Linux CI firmware SHA-256:
  `302eaaea9fdea5d85dca0a15461be80d7c8f33026aadf066a288963ca6aa49b8`
- Firmware CI run:
  `https://github.com/Shrug-Lord/growhub-ce-firmware/actions/runs/35537888732`
- Broker address: private LAN Eclipse Mosquitto instance
- Device hardware: one NIWA Growhub+ release bench controller
- Tested by: project maintainer with Codex-assisted execution
- Tested at: 2026-09-20 (America/New_York)

This record covers the optional MQTT contracts added in CE `1.2.0C` and their
Command Center `0.2.0` UI. The unchanged presence, outlet, schedule, time, mode,
relay, and Run Now contracts inherit the completed multi-device and multi-hardware
evidence in `CE-1.1.0C.md`.

## Management address

- [x] The device publishes retained versioned network state with its current Wi-Fi
      station address and HTTP port.
- [x] Command Center associates network state by stable device MAC and renders an
      Open device management link beside Online and Device state ready.
- [x] The link opens the controller's current management page.
- [x] A real DHCP address change updates the retained state and Command Center link
      without changing device identity, outlet state, or journal history.
- [x] Older firmware without network state remains usable and simply omits the link.

## Confirmed release updates

- [x] Firmware update checks default off and the preference synchronizes between
      the controller page, MQTT, and Command Center.
- [x] Manual Check now reaches GitHub Releases; `1.2.0C` correctly refuses to offer
      the published older `v1.1.0C` as an update.
- [x] Enabling periodic checks persists through reboot, runs a background check,
      and was restored to off after verification.
- [x] Command Center requires explicit confirmation before publishing an install
      request and records the displayed target version and requesting user.
- [x] Later, per-version Skip, stale state, duplicate active requests, malformed
      release metadata, and failed-install retry behavior have automated coverage.

## Dashboard regression

- [x] The live device card reports Online and ready with firmware `1.2.0C`.
- [x] Sensor values and the chart refresh without a page reload.
- [x] Temperature and humidity high, low, and range values render for the selected
      period.
- [x] Card order is Sensor history, Grow journal, Recent activity, then collapsed
      History samples.
- [x] Device online/offline and schedule-load events appear in Recent activity.
- [x] Six controller-page sessions plus 48 concurrent status requests do not break
      Command Center telemetry, MQTT, or the device management link.

## Result

The CE `1.2.0C` extensions required by Command Center `0.2.0` are compatible on
the exact Linux CI firmware image recorded above. No regression was observed in
the retained CE `1.1.0C` contract families, and the controller finished in AUTO
mode with valid time, healthy sensor data, MQTT connected, and all outputs off.
