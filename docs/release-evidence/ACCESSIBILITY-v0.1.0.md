# Accessibility Spot-Check Evidence

Status: passed

- Command Center commit: `cf61981fa73c0f7ae352eeeb97295d57fc42f061`
- Release host: reference Raspberry Pi ARM64 deployment
- Automated browser/Axe evidence: [public CI run 30594047117](https://github.com/Shrug-Lord/growhub-command-center/actions/runs/30594047117)
- Tested by: project maintainer with Codex-assisted Playwright verification
- Tested at: 2026-07-30

## Keyboard-only check

- [x] Sign in and reach the dashboard without using a pointer.
- [x] Move through primary navigation in a logical order with a visible focus indicator.
- [x] Select a device and reach its inline detail and setup regions by keyboard.
- [x] Reach outlet form controls and their enabled actions without a pointer.
- [x] Activate a non-destructive navigation control with Enter and confirm its result is visible.

## Screen-reader check

- [x] Page title, complementary/navigation/banner/main landmarks, and section headings are announced meaningfully.
- [x] Device name and Ready status are announced together rather than conveyed by color alone.
- [x] Buttons and form fields expose useful accessible names, current values, and state.
- [x] Inline device detail and setup regions remain navigable without an inapplicable dialog or focus trap.
- [x] Dynamic success and validation feedback use status and alert semantics and remain discoverable without losing context.

## Result

Passed the focused maintainer-assisted keyboard and VoiceOver run on the
configured release host. macOS Keyboard navigation had to be enabled before
Tab included buttons; this was a host preference, not an application defect.

The review exposed one application issue: repeated outlet controls announced
their value and generic field name without the outlet number. Commit `cf61981`
adds deterministic device-status and per-outlet accessible names, and adds a
browser regression that tabs from the final outlet label to Confirm current
setup and activates it with Enter. The complete public CI run is green.
