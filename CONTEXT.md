# Growhub Command Center

Glossary for the Growhub Command Center context. Implementation details live in source and operational docs; this file records project language.

## Language

**CE firmware**:
The Community Edition firmware that runs on a NIWA Growhub and owns the controller's local runtime behavior. Command Center integrates with CE firmware but is not required for a Growhub to keep running its active automation.

**Command Center**:
The local companion application for managing one or more Growhub devices. It stores reusable planning data, mirrors active device state, and presents fleet-level monitoring.

**Admin login**:
The single local credential used to access Command Center in first ship. It uses a local admin username and password, not an email address or cloud account.
_Avoid_: Admin email, cloud account, user account

**Schedule template**:
A reusable named plan stored in Command Center, such as Seedling, Veg, or Flower. Schedule templates are assignment-based so they can be loaded onto different devices after Command Center matches the template's required outlet assignments and labels to the target device's firmware-owned outlet state.
_Avoid_: Recipe, grow recipe, program, physical-outlet template

**Schedule template revision**:
A lightweight identifier for the saved edit state of a schedule template. It changes when the template is saved and identifies which template state was loaded onto a device without preserving every historical template body.
_Avoid_: Template version history, release version

**Template update available**:
A device state where the active device schedule still matches Command Center's expected active schedule, but the source schedule template has a newer revision than the one last loaded onto that device. Template role label edits create template update availability for already-loaded devices, not immediate label drift.
_Avoid_: Schedule drift, auto-update

**Template deployment state**:
The relationship between a schedule template and the devices that have loaded it, including loaded revision, schedule drift, template update availability, and load actions.
_Avoid_: Device-only schedule state, template-only status

**Draft schedule template**:
A saved schedule template that is still incomplete and cannot yet be loaded onto a device. A template with duplicate assignment and label pairs across roles is a draft until the roles are disambiguated or removed. A template role assigned None also makes the template a draft because None is not a schedulable equipment role.
_Avoid_: Invalid template, broken schedule

**Load-ready schedule template**:
A schedule template whose required roles and conditions are complete enough for Command Center to preflight, compile, and load onto a device.
_Avoid_: Published template, active template

**Template role**:
A stable internal entry in a schedule template that represents one required outlet role. A template role has opaque identity plus editable display data, including a non-None assignment and a required user-facing label. The combination of assignment and label must be unique within one schedule template; all template roles must be mapped before loading the template.
_Avoid_: Template outlet, socket role

**Active device schedule**:
The schedule currently owned by a specific Growhub device and used as the source of truth for that device's automation. An active device schedule is physical-outlet-based after Command Center compiles a schedule template for one target device.
_Avoid_: Running template, active recipe

**Active schedule body**:
The physical-outlet automation rules inside an active device schedule. The active schedule body excludes relay mode, device health warnings, outlet status, and user-facing summaries.
_Avoid_: Runtime state, schedule status

**Expected active schedule**:
The physical-outlet schedule Command Center expects one device to own after a confirmed schedule template load. In AUTO mode, CE firmware evaluates the expected active schedule; in MANUAL mode, the schedule remains loaded but automation is paused until the device returns to AUTO. An expected active schedule is device-specific and separate from the reusable schedule template it came from.
_Avoid_: Desired template, live template

**Device action**:
An immediate command Command Center sends to one device for firmware to perform against current device state, separate from reusable schedule templates.
_Avoid_: Template action, relay shortcut

**Emergency all-off action**:
A device action that asks CE firmware to turn all controlled outlets off immediately for one device and is allowed even when other device actions are pending. Emergency all-off can interrupt a pending schedule load, but it does not cancel already accepted or published device actions and is not schedule drift by itself.
_Avoid_: Routine direct control, MQTT cancellation

**Return to AUTO action**:
A device action that asks CE firmware to resume AUTO relay evaluation after a manual or all-off state. Return to AUTO does not reload a schedule, mutate templates, or change template deployment state.
_Avoid_: Reload template, resume template

**Switch to MANUAL action**:
A device action that asks CE firmware to enter MANUAL mode while preserving current relay outputs so automation stops changing them.
_Avoid_: Stop schedule, clear schedule

**Routine manual relay control**:
A non-emergency device action for ordinary operator relay intervention, such as changing relay mode or directly controlling an outlet outside schedule automation.
_Avoid_: Fire-and-forget relay control, emergency all-off

**Pending return to AUTO action**:
A pending device action created after Command Center asks CE firmware to resume AUTO relay evaluation and before firmware-published state confirms, rejects, or times out that request.
_Avoid_: Pending schedule load, template reload

**Pending relay-control action**:
A pending device action created after Command Center asks CE firmware to set manual relay outputs and before firmware-published relay state confirms, rejects, or times out that request.
_Avoid_: Optimistic relay toggle, direct MQTT relay write

**Interrupted relay-control action**:
A pending relay-control action abandoned because the user sent an emergency all-off action before firmware confirmation.
_Avoid_: Completed relay toggle, canceled MQTT command

**Schedule-changing action**:
A device action that can alter the active device schedule or invalidate Command Center's expected active schedule for one device.
_Avoid_: Concurrent schedule edit, independent schedule action

**Pending device action**:
A device action that Command Center has accepted for delivery but has not yet observed as completed or rejected in firmware-published device state.
_Avoid_: Confirmed action, optimistic state

**Blocked device action**:
A device action Command Center refuses to start because another pending action on the same device would make confirmation, relay behavior, or user feedback ambiguous.
_Avoid_: Queued action, hidden action

**Device action history**:
A record of recent device action attempts, outcomes, local device-scoped decisions, and informational firmware-observed state transitions for one device, including completed, rejected, timed-out, interrupted, blocked, setup-confirmed, drift-detected, and drift-reconciled entries. A confirmed outlet config action that refreshes Device setup review remains one outlet config entry with review metadata, while current-state warnings such as Device state not received and global broker/server conditions such as Broker unavailable are not device action history entries.
_Avoid_: Audit log, telemetry log

**Pending outlet config action**:
A pending device action created after Command Center sends a full replacement outlet configuration to CE firmware and before firmware-published outlet state confirms or rejects it.
_Avoid_: Optimistic outlet edit, partial outlet patch

**Rejected outlet config action**:
A pending outlet config action that CE firmware rejected with an outlet configuration error before Command Center observed matching firmware-owned outlet state.
_Avoid_: Timed-out outlet edit, schedule error

**Timed-out outlet config action**:
A pending outlet config action that Command Center could not confirm or reject from firmware-published outlet state within the local confirmation window. A timed-out outlet config action is not retried automatically.
_Avoid_: Failed outlet write, confirmed outlet edit

**Pending schedule load**:
A pending device action created after Command Center sends a compiled active schedule to CE firmware and before firmware-published state confirms or rejects it. A pending schedule load does not replace the expected active schedule until confirmed.
_Avoid_: Confirmed schedule, optimistic schedule load

**Interrupted schedule load**:
A pending schedule load abandoned because the user sent an emergency manual all-off action before firmware confirmation. An interrupted schedule load is not treated as a completed template load.
_Avoid_: Failed load, confirmed load

**Rejected schedule load**:
A pending schedule load that CE firmware rejected with a schedule-specific write error before Command Center observed a matching active schedule body.
_Avoid_: Timed-out load, health warning

**Timed-out schedule load**:
A pending schedule load that Command Center could not confirm or reject from firmware-published state within the 15-second confirmation window. It is not retried automatically. For a bounded 60-second reconciliation grace, an exact newer firmware schedule may still turn it into a late-confirmed schedule load when no later schedule-changing or emergency action superseded it; otherwise it remains timed out and does not replace the expected active schedule.
_Avoid_: Failed firmware schedule, confirmed load

**Late-confirmed schedule load**:
A schedule load that crossed the normal confirmation deadline but was proven during the bounded reconciliation grace by an exact newer firmware-owned active schedule, with no later schedule-changing or emergency action superseding it. It completes with late-confirmation context and establishes the expected active schedule without publishing the schedule again.
_Avoid_: Automatic retry, assumed success, ordinary on-time confirmation

**Device health warning**:
A firmware-published warning about current device conditions, such as missing valid wall time, unhealthy SNTP sync, or unavailable sensor data. A device health warning may affect active automation but does not make a schedule template invalid.
_Avoid_: Schedule validation error, template error

**Time sync action**:
A device action that lets Command Center ask CE firmware to set the controller's current wall time so wall-clock automation can run.
_Avoid_: Browser sync, schedule fix

**Pending time sync action**:
A pending device action created after Command Center asks CE firmware to set wall time and before firmware-published state confirms, rejects, or times out that request.
_Avoid_: Fire-and-forget time sync, schedule load

**Schedule drift**:
A difference between Command Center's expected active schedule and the firmware-owned active schedule body on a specific Growhub after local device edits or another accepted firmware-side change. Schedule drift is independent of relay mode: a device may still be in AUTO and running the firmware-owned active schedule while drifted from Command Center's expected template deployment. Schedule drift remains a visible mismatch until the user reconciles it through confirmed schedule load or reload, schedule adoption, or drift acknowledgement.
_Avoid_: Template sync, recipe mutation

**Schedule drift reason**:
A best-effort explanation for why Command Center believes schedule drift appeared on one device. A schedule drift reason helps the user understand the current mismatch and its history, but is not treated as a guaranteed root cause.
_Avoid_: Firmware error, audit proof

**Drift acknowledgement**:
A user decision to stop expecting one device to match a previous expected active schedule. Drift acknowledgement unlinks the current device state from that expected active schedule while preserving load history.
_Avoid_: Accept changes, delete history

**Schedule adoption**:
A user decision to create a new schedule template from a firmware-owned active device schedule. Schedule adoption creates a separate reusable template, links the originating device to that template when the adopted firmware state is still current, and does not update an existing schedule template.
_Avoid_: Update template, template sync

**Adoptable active schedule**:
A firmware-owned active device schedule that Command Center can save as a new schedule template. An adoptable active schedule is non-empty, uses a supported schedule shape, and references only physical outlets that currently have firmware-owned assignments.
_Avoid_: Importable recipe, copied schedule

**Label drift**:
A difference between Command Center's expected mapped outlet label and the current firmware-owned outlet label for the mapped physical outlet. Label drift appears as a non-blocking schedule preflight warning when the outlet assignment remains compatible. It does not invalidate a role mapping, block loading, or automatically change the reusable schedule template.
_Avoid_: Label mismatch error

**Label drift acknowledgement**:
A user decision to accept the current firmware-owned outlet label for one device role mapping. Label drift acknowledgement clears label drift by making the accepted firmware label the device mapping's expected label, without renaming the firmware outlet or changing the reusable schedule template.
_Avoid_: Template label update, firmware rename

**Outlet label repair**:
A user action that asks CE firmware to rename a physical outlet so it matches Command Center's expected mapped outlet label. Outlet label repair resolves label drift but is separate from schedule loading.
_Avoid_: Silent rename, schedule load rename

**Device**:
A single NIWA Growhub controller running CE firmware.
_Avoid_: Socket controller, hub instance

**Device registry**:
Command Center's local catalog of Growhub devices, keyed by the device MAC published in CE firmware MQTT topics.
_Avoid_: Manual device list, account device list

**Device presence**:
The online or offline availability of a device as reported by CE firmware. Device presence is separate from sensor freshness and does not by itself describe the current outlet or schedule state.
_Avoid_: Last sensor seen, live snapshot

**Broker unavailable**:
A Command Center condition where the server cannot communicate with the configured MQTT broker, so MQTT-backed device actions cannot publish and retained-state recovery is paused. It is separate from Device presence, is not a retained-state incident, and is not a device action history entry.
_Avoid_: Device offline, device disconnected, retained state missing

**Server health**:
The Command Center-wide operational status of server dependencies and recovery work, such as MQTT broker connection and retained-state rebuild. Server health is global rather than scoped to one device.
_Avoid_: Device health, device warning

**Command Center release update**:
A newer verified, tagged GitHub Release of Command Center than the version currently installed. Ordinary commits on the repository's main branch are not offered as appliance updates. Dismissing an available release suppresses the prompt for that release only; a later tagged release may prompt again.
_Avoid_: Main-branch update, firmware update, template update

**Automatic Command Center updates**:
An operator setting that permits Command Center to install newer verified, tagged GitHub Releases without requiring routine shell access to the Pi. Automatic updates never install arbitrary main-branch commits.
_Avoid_: Firmware OTA, unattended main-branch deployment

**Device summary signal**:
A device-list or dashboard indicator for one specific aspect of a Growhub, such as Device presence, Device setup review, or Device health warning. Device summary signals are shown as separate signals rather than collapsed into one overall device status.
_Avoid_: Single device status, overall health

**Needs attention**:
The aggregate device summary signal for current warning conditions that need user review. It summarizes warning count plus the highest-priority current condition, while surfaces that already show Device setup review separately do not double-count setup review inside Needs attention.
_Avoid_: Every warning as top-level status, device unhealthy

**Device connected**:
A device onboarding state where Command Center has discovered a Growhub through firmware-published presence, but may still be waiting for retained device state needed for safe workflows.
_Avoid_: Device ready, fully set up

**Device ready**:
A device onboarding state where Command Center has device presence plus the retained firmware state needed for normal setup and schedule workflows.
_Avoid_: Connected only, MQTT seen

**Device mirror**:
Command Center's persisted copy of the latest firmware-published state for one device. The device mirror is read by the UI and refreshed by the server's MQTT subscriptions.
_Avoid_: Browser state, inferred state, sensor-derived state

**Firmware state revision**:
A server-persisted monotonic sequence for one device and one accepted firmware state family. It advances for every valid observation, including duplicate QoS delivery, so later device actions can require confirmation newer than their captured base state.
_Avoid_: Schedule template revision, MQTT packet id

**Firmware error sequence**:
A server-persisted monotonic sequence for one device and one accepted firmware error family. It lets later device actions ignore old or unrelated firmware rejections when resolving a pending command.
_Avoid_: Error count, request id

**Firmware contract blocker**:
A typed workflow blocker shown when a required retained CE state is still missing after recovery grace or uses an unsupported contract version. Compatible sensor monitoring and other independent read-only state remain available where possible.
_Avoid_: Device offline, generic firmware version warning

**Syncing retained state**:
A temporary Command Center status for a device or device action while the server is waiting for retained firmware state needed to rebuild the device mirror or resolve a persisted pending action. It can appear as a device summary signal during startup or reconnect while required retained topics are missing, then narrows inline after those topics are mirrored; if required state stays missing past the initial sync window, it becomes an actionable Needs attention condition that clears when the missing state arrives.
_Avoid_: Offline, disconnected device, stale mirror

**Retained-state incident**:
A diagnostics-only record of a missing required retained firmware state condition for one device and one logical retained state, including when the condition began and resolved. A retained-state incident is not a device action history entry.
_Avoid_: Device action, health log

**Device setup**:
The Command Center workflow for reviewing and changing a device's firmware-owned outlet assignments and outlet labels before schedule templates are edited or loaded. After a Ready device has current Device setup review, onboarding can complete and route to normal device pages even when unrelated warnings remain visible in their own workflows.
_Avoid_: Outlet profile setup, local outlet setup

**Stale outlet edit draft**:
A Device setup edit draft based on firmware-owned outlet assignments or labels that changed after editing began. It is a form workflow state, not a device action; it can be viewed for reference, but cannot be applied until the user reloads firmware state or copies only non-conflicting edits into a fresh draft based on current firmware state.
_Avoid_: Mergeable draft, queued outlet edit

**Device setup reviewed**:
A per-device Command Center state where the user has reviewed, confirmed, or successfully applied the current firmware-owned outlet assignments and outlet labels after the device is Ready. The review remains valid only while the current firmware-owned outlet assignments and labels match the reviewed outlet state. Monitoring can work before Device setup is reviewed or after it becomes stale, but Command Center should not imply the device is schedule-ready until review is current.
_Avoid_: Device ready, preflight success

**Stale device setup review**:
A device setup state where the firmware-owned outlet assignments or labels changed after the user last reviewed them. Schedule loading is blocked until the user refreshes Device setup review.
_Avoid_: Device offline, label drift

**Confirm current setup action**:
A local Command Center action where the user explicitly confirms the current firmware-owned outlet assignments and labels as reviewed for one device, including intentionally unassigned outlets but not outlet label conflicts. It is scoped to outlet assignment and label ambiguity; unrelated device health warnings, schedule drift, unscheduled assigned outlets, and template preflight warnings do not prevent confirmation, and it is recorded as a local completed device action history entry rather than a pending MQTT action.
_Avoid_: Page view, implicit review

**Outlet assignment**:
The firmware-owned equipment type for a physical Growhub outlet, such as Light, Fan, Humidifier, Dehumidifier, Water Pump, Heater, AC Controller, or None when no equipment role is assigned. Command Center mirrors outlet assignments and may request changes, but CE firmware is the source of truth.
_Avoid_: Connected device, socket function

**Outlet label**:
A firmware-owned user-facing role name for a physical Growhub outlet, such as Exhaust Fan, Circulation Fan, Reservoir Pump, or Canopy Light. Outlet labels disambiguate duplicate outlet assignments when Command Center compiles a portable schedule template for one device.
_Avoid_: Socket name, relay name

**Outlet label conflict**:
A device setup state where two or more firmware-owned physical outlets have the same non-None assignment and the same outlet label. An outlet label conflict makes role mapping ambiguous and blocks Device setup review until the labels are disambiguated. Duplicate labels on outlets assigned None are not outlet label conflicts because unassigned outlets are not schedule roles.
_Avoid_: Label drift, duplicate outlet

**Schedule-load preflight**:
The Command Center check that evaluates whether one schedule template can be loaded onto one device. Schedule-load preflight identifies load blockers that prevent loading and preflight warnings that require user confirmation or remediation before loading.
_Avoid_: Display validation, compile result

**Schedule compile**:
The Command Center step that matches a schedule template's template roles to one device's firmware-owned outlet state and produces the physical-outlet schedule sent to CE firmware. All template roles must map before compile; Command Center does not create partial schedules by dropping roles the target device lacks. Extra assigned firmware outlets are allowed but receive no schedule entry from the compiled template.
_Avoid_: Schedule sync, recipe conversion

**Role mapping**:
A Command Center record that maps a schedule template role to a physical outlet on one specific device. Role mappings are created by confirmed schedule loads, not by abandoned preflight previews. Role mappings are reused while the firmware outlet keeps a compatible assignment. Label-only outlet changes do not invalidate role mappings. Only mappings for outlets whose assignment changes or disappears are invalidated; mappings for unchanged compatible outlets remain.
_Avoid_: Outlet binding, schedule binding

**Ambiguous role mapping**:
A role mapping that Command Center cannot infer safely because more than one firmware-owned outlet could satisfy the same schedule template role.
_Avoid_: Best match, fuzzy match

**Role mapping conflict**:
A load-blocking state where two or more schedule template roles are mapped to the same physical outlet on one device.
_Avoid_: Shared outlet, merged role

**Diagnostics bundle**:
An authenticated, read-only JSON export of current Command Center runtime,
firmware mirror, action, error, and bounded incident evidence. It is redacted for
support sharing and is not a state backup or a command surface.
_Avoid_: Database backup, MQTT export, support command

**Restore backup**:
A checksum-validated archive of both Command Center app data and bundled
Mosquitto retained state used to reproduce an installation. A restore backup
contains sensitive local state and must not be attached to public issues.
_Avoid_: Diagnostics bundle, database-only copy

**Release evidence**:
The recorded automated, deployment-host, and CE hardware results required
before publishing a compatible Command Center tag. Release evidence identifies
the tested Command Center commit and CE firmware contract instead of inferring
compatibility from display version alone.
_Avoid_: Assumed compatibility, build success only
