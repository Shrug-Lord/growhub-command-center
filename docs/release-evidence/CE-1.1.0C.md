# CE 1.1.0C Hardware Compatibility Evidence

Status: passed

- Command Center commit: `e86756e09a7646caf50c0987d3c17833dd8b839e`
- CE firmware version: 1.1.0C
- CE firmware commit: `15dcf80807e8c9c6cd9faaf49ded4d5175c407b1`
- Test-session base: pre-publication Command Center candidate represented by the
  public baseline; CE firmware `24ac60a349d63f48f3fcd78700a25f2f94e38a2f`
- Broker/version: Eclipse Mosquitto 2.0.22 (`eclipse-mosquitto:2.0@sha256:212f89e1eaeb2c322d6441b64396e3346026674db8fa9c27beac293405c32b3c`)
- Device hardware: 2x NIWA Growhub+, 1x original NIWA Growhub
- Tested by: project maintainer with Codex-assisted execution
- Tested at: 2026-07-21 through 2026-07-26 (America/New_York)

## Presence and Recovery

- [x] Retained online state discovers a clean device.
- [x] Firmware offline state and unexpected disconnect produce the documented
      presence behavior.
- [x] Command Center restart rebuilds presence, outlet, schedule, mode, outputs,
      warnings, and time health from retained state.
- [x] Broker reconnect does not duplicate actions, events, or drift episodes.

## Outlet Assignment and Labels

- [x] Retained `outlets/state` mirrors physical outlet ids 1-4.
- [x] Full `outlets/config` assignment and label replacement confirms from newer
      retained state and persists across firmware reboot.
- [x] A label-only edit preserves schedules and relay state.
- [x] An assignment edit clears affected schedule entries and local pause bits,
      and AUTO reevaluates the affected output.
- [x] Invalid, partial, duplicate, and unsupported writes publish the documented
      `outlets/error` reason and leave state unchanged.

## Schedule and Drift

- [x] A CE v3 physical schedule load confirms from newer `schedule/state` and
      persists while Command Center is disconnected.
- [x] Missing and ambiguous assignments block preflight.
- [x] Extra assigned outlets and label drift warn without changing firmware.
- [x] A firmware-local schedule edit remains authoritative and creates one drift
      episode with working reload, save-new-template, and acknowledge paths.
- [x] Invalid schedule writes publish the documented error and do not establish
      a Command Center expectation.

## Time

- [x] `time/action sync_epoch` produces valid wall time and newer retained
      `schedule/state` with source `time`.
- [x] Invalid version, action, payload, and epoch produce the documented
      `time/error` reasons without changing configuration.
- [x] Time sync immediately reevaluates AUTO schedule output.

## Mode and Relay

- [x] Switch to MANUAL preserves current outputs and confirms from newer state.
- [x] Complete four-outlet manual masks control the intended physical outlets.
- [x] Emergency all-off produces MANUAL mode with all four outlets OFF.
- [x] Return to AUTO immediately resumes firmware schedule evaluation.
- [x] Invalid control writes publish the documented errors and do not produce
      false Command Center completion.

## Pump Run Now

- [x] Run Now works only for a mapped Water Pump while the device is in AUTO.
- [x] Confirmation requires newer structured state showing the pump ON.
- [x] Repeating Run Now while already running is a no-op and does not extend it.
- [x] Firmware duration completion turns the pump off under firmware control.
- [x] Schedule errors reject only the matching pending command family.

## Observed Evidence

Record representative sanitized MQTT request/state/error payloads, timestamps,
and any deviations here. Do not include broker credentials, private addresses,
or unrelated device identifiers.

### Retained discovery — 2026-07-21

After the verified Command Center stack restarted from the recorded commit, the
authenticated dashboard showed all three sanitized bench-device entries as
Online/Ready with firmware `1.1.0C` and complete four-outlet state. A read-only
database mirror query confirmed compatible retained `presence_state` and
`outlet_state` records for every device alias. Sensor traffic was not used as
discovery evidence, and no registry or broker data was reset for this check.

### Unexpected disconnect and recovery — 2026-07-21

One Growhub+ bench device was disconnected from power while Command Center and
the broker remained online. Command Center changed only that device to Offline,
created exactly one `device_offline` event, and opened one critical
`device_offline` alarm. The other two devices remained Ready. After power was
restored, the device republished compatible presence, outlet, and schedule state,
returned to Online/Ready, and resumed fresh sensor telemetry. Command Center
created exactly one `device_online` event and automatically resolved the matching
alarm; it created no duplicate transition events. The recovered schedule state
reported MANUAL mode, all four outputs OFF, valid SNTP time, and no firmware
warnings. The recorded firmware configures its QoS 1 `offline` Last Will and its
`online` status publication as retained messages.

### Command Center retained-state reconstruction — 2026-07-21

With all three devices and Mosquitto left running, only the Command Center server
was restarted. Before restart, a sanitized baseline captured presence, outlet,
schedule, mode, output, warning, and time-health values for each device. After
the server became healthy and resubscribed, all nine required mirror rows were
replayed as retained and compatible. Each `presence_state`, `outlet_state`, and
`schedule_state` revision advanced by exactly one, with values identical to the
baseline. All devices reconstructed as Online, firmware `1.1.0C`, MANUAL mode,
and four outputs OFF. Empty warning sets, valid SNTP time, outlet assignments,
labels, and each device's active-or-empty schedule were preserved. No Growhub or
broker restart was used for this check.

### Broker reconnect — 2026-07-21

Only Mosquitto was restarted while Command Center and all three Growhubs remained
running. Each device generated one offline-to-online transition pair during the
real MQTT interruption, with no repeated same-state events. The three temporary
critical offline alarms resolved automatically on reconnect. Completed action
counts were unchanged, there were no pending or new actions, and drift-event
counts remained zero. The reconstructed outlet assignments, schedules, MANUAL
mode, four OFF outputs, empty warning sets, and valid SNTP health matched the
pre-restart baseline. All mirrored state remained compatible, fresh telemetry
resumed, and no retained-state incident remained active.

### Physical outlet mapping and manual masks — 2026-07-23

Using one Growhub+ with a phone charger as a low-power indicator, the operator
tested physical outlets 1-4 individually from Command Center in MANUAL mode and
confirmed each outlet turned ON and OFF as addressed. Completed action records
produced the intended nonsequential relay masks: Outlet 1=`8`, Outlet 2=`1`,
Outlet 3=`2`, and Outlet 4=`4`; each OFF confirmation returned the mask to `0`.
The compatible outlet mirror and direct firmware status both exposed physical ids
1-4 in order. At completion, Command Center and firmware agreed on MANUAL mode,
all four outputs OFF, valid SNTP time, and no warnings. No mains load beyond the
low-power charger was used.

### Full outlet replacement and reboot persistence — 2026-07-23

Command Center replaced all four assignments and labels on one Growhub+ with a
distinct bench configuration: Light/`Bench Light`, Fan/`Bench Fan`,
Humidifier/`Bench Humidifier`, and Water Pump/`Bench Pump`. Firmware confirmed
the action from a newer compatible outlet mirror at revision 16, and a fresh
subscriber received the same retained `outlets/state`. After a physical firmware
power cycle, the device republished the identical document with source
`reconnect`; Command Center advanced the outlet mirror to revision 17. Firmware
remained on `1.1.0C` with WiFi, MQTT, sensors, and SNTP healthy. MANUAL mode and
all four OFF outputs were preserved across the reboot, with no warning present.

### Rejected outlet writes — 2026-07-23

Five non-retained `outlets/config` requests were sent directly to one bench
device: malformed JSON, a partial replacement, duplicate outlet id, unsupported
config version, and invalid assignment enum. Firmware published the documented
non-retained `outlets/error` reasons `invalid_payload`, `missing_outlets`,
`duplicate_outlet` with outlet 1, `unsupported_outlet_config_version`, and
`invalid_assignment` with outlet 1. Command Center mirrored all five errors and
advanced only the outlet-error sequence to 5. The compatible outlet-state mirror
remained at revision 17, and a fresh retained subscription returned the unchanged
accepted four-outlet bench configuration.

### Schedule preflight and firmware confirmation — 2026-07-23

A load-ready four-role template was reviewed against two sanitized Growhub+
configurations. The incompatible target had two Light outlets whose labels did
not match the template role, no Water Pump outlet, one Fan outlet, and one
Humidifier outlet. Preflight therefore required an explicit Light choice and
reported the missing Water Pump assignment; the final Load control remained
disabled and no action was created. The compatible target inferred all four
roles by their distinct assignments and labels with no warnings.

Loading the compatible target compiled one CE v3 physical schedule with
time-window rules on outlets 1 and 2, an rH low-band rule on outlet 3, and a
weekly interval rule on outlet 4. The action was acknowledged and completed from
a newer compatible retained `schedule/state`: the mirror advanced from revision
186 to 187, source became `mqtt`, and the returned schedule exactly matched the
compiled confirmation document. Firmware remained in MANUAL mode with all four
outputs OFF, valid SNTP time, and no warnings. The initial client response
returned while the action was pending and left stale waiting copy after the
server had already confirmed it; Command Center was corrected to poll the typed
action through its terminal state, show success only for `completed`, and keep
rejections or timeouts on the review screen. Client tests cover the
pending-to-completed transition.

For the disconnected-persistence check, only the Command Center server was
stopped; Mosquitto and the target Growhub remained independent and available.
The operator then power-cycled the Growhub. While Command Center was still
offline, a fresh retained MQTT subscription received the exact CE v3 schedule
with source `reconnect`, and the device-local `/status` endpoint reported
firmware `1.1.0C`, healthy WiFi/MQTT/SNTP/sensor state, MANUAL mode, and all four
outputs OFF. After Command Center restarted, it reconstructed the same compatible
schedule at mirror revision 189, reported the device Online in MANUAL mode, and
had zero pending actions. This confirms the accepted schedule is firmware-owned
and persists without Command Center.

### Label-only edit and preflight warnings — 2026-07-24

A label-only full outlet replacement was applied to the compatible Growhub+
while it remained in MANUAL mode with all outputs OFF. Firmware confirmed the
new retained outlet label without changing the accepted CE v3 schedule, mode, or
relay mask. The original label was then restored through the same confirmed path.

Preflight was also exercised against a target with extra assigned outlets and
firmware labels that differed from the template roles. Command Center reported
both conditions as review warnings, left firmware state unchanged, and required
explicit operator acknowledgement before enabling a replacement load. A target
with exact assignments and labels mapped all four roles without warnings.

### Rejected schedule, time, and control writes — 2026-07-24

Direct non-retained contract probes covered malformed and unsupported schedule
writes, invalid time versions/actions/payloads/epochs, and invalid control
commands. Firmware published the corresponding typed error family for each
request and retained its previous configuration, schedule, mode, and relay
state. Command Center mirrored the errors without recording false action
completion or changing the active schedule expectation.

A valid `time/action` `sync_epoch` request produced a newer retained
`schedule/state` with source `time` and valid wall time. The device remained in
MANUAL mode with all four outputs OFF. A later AUTO-mode probe is recorded
below.

### Firmware-local schedule drift and reconciliation — 2026-07-24

The firmware-local editor changed one time-window start while the device was in
MANUAL mode with all four outputs OFF. Command Center preserved that
firmware-owned value, created one active drift episode, and exposed all three
documented reconciliation paths:

- **Reload expected** replaced the local edit only after explicit warning
  acknowledgement and cleared the drift after newer firmware confirmation.
- **Save as new template** created and linked a revision-1 template from the
  current firmware schedule without publishing a replacement.
- **Acknowledge drift** unlinked the current expectation, preserved the
  firmware schedule, reconciled the episode, and updated the dashboard live.

The temporary adopted template was deleted after it became unlinked. The
original `CE Contract Bench` revision 1 was then loaded again and confirmed by
firmware. Final state was MANUAL, all four outputs OFF, with time windows
06:00-22:00, humidity low-band 40/45% rH, and a one-minute interval every
168 hours.

This live sequence found and corrected three release-blocking UI defects:

- the firmware editor limited pump intervals to 24 hours and pump duration to
  60 minutes even though the contract permits 168 hours and 240 minutes; a
  valid weekly pump silently prevented the browser from submitting any local
  schedule edit
- Command Center retained stale nullable drift state after the server explicitly
  returned `null`, leaving a resolved warning visible
- drift details were cached across distinct drift episodes, causing
  acknowledgement to submit a stale fingerprint and be blocked as
  `device_state_changed`

Regression tests now cover explicit-null state replacement and episode-scoped
drift-detail reuse. The corrected client was rebuilt and deployed, and the
acknowledgement banner cleared without a page reload during live retest.

### AUTO, mode, assignment, and Pump Run Now — 2026-07-24

The linked `CE Contract Bench` schedule was exercised in AUTO with its two
06:00-22:00 outlets ON and its humidity and interval outlets OFF. Switching to
MANUAL confirmed from newer firmware state without changing the ON/ON/OFF/OFF
mask; the operator's low-power indicator on Outlet 1 remained powered.
Emergency all-off then confirmed MANUAL mode with all four outputs OFF. Return
to AUTO immediately reevaluated the schedule and restored ON/ON/OFF/OFF.

Changing Outlet 1 from Light to Fan through a full outlet replacement cleared
only Outlet 1's schedule entry and turned that outlet OFF in AUTO. Firmware's
local status retained Outlet 2's time window, Outlet 3's humidity band, and
Outlet 4's interval. Restoring the Light assignment and explicitly reloading
the expected template restored the complete four-outlet schedule and powered
Outlet 1 again.

Pump Run Now activated only the mapped Water Pump on Outlet 4 while the device
remained in AUTO. Command Center completed the action only after newer
structured firmware state showed Outlet 4 ON. A second request 53 seconds later
completed synchronously as `already_in_requested_state`; the original timer was
not extended, and firmware turned Outlet 4 OFF at the original one-minute
deadline. The operator confirmed the physical indicator ON during the run and
OFF after firmware duration completion.

A direct valid `time/action` probe while the same schedule was in AUTO advanced
the schedule-state mirror from revision 233 to 234, changed the state source to
`time`, retained valid wall time, and immediately returned the correct
ON/ON/OFF/OFF schedule-derived mask. This closes the AUTO time-reevaluation
check without changing time configuration.

Live invalid-write probes had already shown that the exact firmware publishes
schedule, outlet, time, and control failures on their documented typed error
topics. A focused action-engine regression test now holds a time-sync action
pending, delivers a newer `schedule/error`, verifies the action stays pending,
then delivers the matching `time/error` and verifies rejection. This locks the
server-side command-family attribution rule without fabricating bench state.

During this sequence, a valid schedule-engine publication used
`source: "schedule"`. Command Center's closed source allowlist initially omitted
that documented firmware value and incorrectly classified the otherwise
complete state as `incomplete_schedule_state_contract`. The parser now accepts
`schedule`, with a regression fixture proving compatibility. Command Center
also now stores incompatible state snapshots for authenticated diagnostics but
does not notify action, drift, or state observers from them; this prevents a
malformed or future incompatible snapshot from falsely completing work or
creating drift.

### Raw light-level contract — 2026-07-26

Bench measurements on both a Growhub+ and the original Growhub disproved the
earlier `0`-`100` percentage assumption. Covering either sensor produced `0`,
while a phone flashlight produced raw readings above `200`; the original
Growhub reached `251` during the final deployed-stack test. The sensor protocol
field is therefore treated as an unsigned byte with range `0`-`255`, not a
calibrated percentage or lux measurement.

Before correction, Command Center rejected the complete `sensor/live` message
whenever `l` exceeded `100`. The parser now requires an integer from `0` through
`255`, with regression coverage for `255`, `256`, and fractional values. The
dashboard labels the card `Light level`, and the chart tooltip and raw-data
table no longer append a percent unit.

The corrected Command Center build was deployed before the final flashlight
test. Its database stored live light levels `251`, `246`, `222`, `207`, and
other above-100 readings without any `invalid_sensor_reading` rejection.
Playwright confirmed all three devices Ready, the unit-free Light level card,
a unit-free `LIGHT` table column, and the accepted above-100 readings visible in
history. All three controllers then ran the same exact verified OTA image.

### Automated verification — 2026-07-24

The final working trees passed Command Center formatting and lint checks, 96
server tests, 25 client/release-readiness tests, 26 focused integration tests,
the production web build, and the isolated Chromium smoke/accessibility flow.

The CE firmware verified-build workflow compiled the final image, regenerated
the first-flash bundle from that exact output, compared packaged `firmware.bin`
byte-for-byte with the PlatformIO build, and passed ZIP integrity checks. An
independent extraction verified every outer and bundled checksum, confirmed the
bundled flasher and merged image match their sources, and confirmed the
application region at offset `0x20000` matches the final OTA image. The bundle
manifest was corrected to name only the files actually present in the ZIP.

The OTA image SHA-256 is
`b547e5052afed85f846bc5e2496b47df86404b820b89127f7b635a2f9d6b4461`;
the first-flash ZIP SHA-256 is
`8e0d10a2bb3ff1909a38bcd47a48234761eaa9c4f7c44dc8bb38b7f4932e19a9`.
Both Growhub+ controllers and the original Growhub accepted that exact OTA
image and returned Online, Ready, Compatible, warning-free retained state.

The CE 1.1.0C hardware-contract checklist is complete for the commits recorded above.
