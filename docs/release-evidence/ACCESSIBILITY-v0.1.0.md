# Accessibility Spot-Check Evidence

Status: pending

- Command Center commit: `b69459a126bed12809e201c4b1053a6883eece39`
- Release host: reference Raspberry Pi ARM64 deployment
- Automated browser/Axe evidence: [public CI run 30501078170](https://github.com/Shrug-Lord/growhub-command-center/actions/runs/30501078170)
- Tested by: pending
- Tested at: pending

## Keyboard-only check

- [ ] Sign in and reach the dashboard without using a pointer.
- [ ] Move through primary navigation in a logical order with a visible focus indicator.
- [ ] Open and close a device detail or setup dialog by keyboard; focus returns to the trigger.
- [ ] Reach form controls, warnings, and disabled-action explanations without a pointer.
- [ ] Activate a non-destructive control with the keyboard and confirm its result is visible.

## Screen-reader check

- [ ] Page title, primary landmark, navigation, and main heading are announced meaningfully.
- [ ] Device status and warning text are read in context rather than by color alone.
- [ ] Buttons and form fields have useful accessible names and state.
- [ ] A dialog announces its title and content, traps focus while open, and returns focus when closed.
- [ ] Dynamic status or validation feedback is announced or discoverable without losing context.

## Result

Pending the focused maintainer-assisted keyboard and VoiceOver run on the
configured release host. Automated Playwright and Axe coverage is already
green; this record is intentionally not marked passed until the spoken and
keyboard behavior is observed.
