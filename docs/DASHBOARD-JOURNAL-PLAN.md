# Dashboard and grow journal enhancements

Status: implemented and verified; all AC1–AC11 checks passed, including the selected controller’s physical DHCP address change after reconnect. See [verification evidence](DASHBOARD-JOURNAL-VERIFICATION.md).

## Scope requested

- Refresh sensor history with each device poll without a page reload.
- Add a button that opens the selected device's own management page and follows
  address changes automatically through firmware-reported MQTT state.
- Show temperature and humidity lows, highs, and ranges for the selected history period.
- Make dashboard cards collapsible, except Device controls, which stays expanded.
- Order the lower dashboard: Sensor history, Grow journal, Recent activity,
  History samples. History samples is the final section.
- Put device online/offline transitions in Recent activity instead of Grow journal.
- Record observed device IP-address changes in Recent activity without duplicate
  entries for reconnects or unchanged address reports.
- Show elapsed time in the current grow phase and duration of completed phases,
  with a days/weeks switch while keeping date/time stamps visible.
- Prompt to log a phase change when switching schedules.
- Show newly loaded schedules in Recent activity.
- Add a compact current-phase/grow-age summary, quick-add buttons, and entry-type
  filters to make the journal faster to read and use.

## Architecture recommendation

Keep the existing JavaScript stack: React/Vite/Recharts in the browser,
Node/Express/SQLite on the server, and the existing server-owned MQTT integration.
These features fit the existing architecture; no framework migration or new
major dependency is proposed. Firmware remains authoritative for active schedules.
Scope also includes extending the existing ESP-IDF C firmware to report its current
management address. Automatic updates after DHCP changes are required; a manually
saved address does not satisfy this requirement.

The current React documentation describes cleanup to prevent stale requests from
overwriting newer state: [useEffect](https://react.dev/reference/react/useEffect).
Retain the existing cancellation and sequence guards when refreshing history.
SQLite supports raw-reading extrema through its built-in
[MIN/MAX aggregates](https://www.sqlite.org/lang_aggfunc.html); derive summary
statistics before averaging chart points.

## Findings from the code

- `DevicesContext.jsx` polls devices every five seconds while visible and refreshes
  when the tab becomes visible. `DeviceDashboard.jsx` requests history only on
  mount or a selected-period change.
- `useDeviceData.js` already cancels superseded history requests and isolates
  history errors from the rest of the dashboard.
- The history API averages readings into at most 1,000 time buckets. Computing
  extrema from those averages would hide actual peaks and troughs.
- The current dashboard places Recent activity above Sensor history and History
  samples above Grow journal.
- Presence transitions are written to `grow_events` by `mqtt.js` and rendered
  alongside manual journal entries. The transition handler already ignores
  repeated identical presence states.
- Recent activity reads confirmed/pending device actions and device events. It
  already recognizes schedule loads, but displays generic labels and polls every
  15 seconds independently of the device poll.
- The grow journal supports phase changes, observations, nutrients, pH adjustments,
  and training. It stores timestamps and permits backdated entries. There is no
  grow-cycle grouping or phase-duration summary today.
- Schedule loading already distinguishes firmware-confirmed completion from
  pending, rejected, timed-out, and interrupted attempts. Phase-change prompting
  must respect that distinction and allow schedule changes within the same phase.
- The MQTT device mirror currently has no management address. `parseSensor` exposes
  identity, name, firmware version, readings, and observation time; its consumer
  writes `ip: null`. The database has an IP-address column, but the public device
  view does not expose it. The current firmware MQTT contract does not provide a
  management-address field. Firmware knows its station IP locally; automatically
  reporting that address would require extending the firmware integration.

## Plan

1. Resolve the journal model and user interactions through one design question at
   a time; capture agreed terms in `CONTEXT.md` and decisions here.
2. Fix history refresh and selected-period statistics, expose a reliable device
   management link using a firmware MQTT extension, and implement the requested
   section ordering and collapse behavior.
3. Separate operational activity from grow entries, preserving existing records;
   give confirmed schedule loads clear names and outcomes in Recent activity.
4. Implement the agreed phase timeline, duration display, and optional phase-entry
   flow following confirmed schedule changes.
5. Verify API behavior, polling races, phase calculations, and real browser flows;
   update user/developer documentation with the resulting behavior.

## Agreed decisions

### Named grows

The journal groups entries into named grows, with at most one active grow per
device and previous grows preserved. Each grow has its own phase timeline,
completed phase durations, and current-phase elapsed time. Starting the next crop
starts a separate timeline without losing earlier dates or notes.

Existing journal entries remain available as unassigned history; migration does
not guess which grow they belong to. Users can select unassigned entries and assign
them to a named grow on the same device, preserving their content and actual
timestamps. Assigned phase changes contribute to that grow's timeline. The current
database stores only device and optional template references, so existing data
provides no authoritative grow boundaries to infer.

### Explicit End grow action

Ending a grow requires a separate `End grow` action. Harvest remains a phase that
may last multiple days; logging Harvest does not automatically finish the grow.
The end action records the actual end date/time and stops the grow's and final
phase's elapsed-time counters at that timestamp. It preserves the journal and
does not change the device's schedule, relay mode, or outlet state. A grow may
also be ended before Harvest.

### Flexible phase timeline

Phase changes may skip or revisit phases; no fixed progression is enforced. Each
occurrence remains a separate dated segment with its own duration. For example,
Veg → Flower → Veg produces three segments, preserving both Veg periods rather
than merging them or replacing the first one.

### Custom phase names

Keep Seedling, Veg, Flower, Flush, and Harvest as default phase choices and offer
`Add custom phase` when logging a phase change. Custom names, such as Germination,
Drying, or Curing, participate in the same timeline and duration behavior as the
defaults; choosing a custom name does not impose a required phase order.

### Corrections to phase entries

Phase entries remain editable in both active and ended grows. Users can correct
the phase name and actual date/time, including backdating a late entry; affected
phase durations recalculate from the corrected chronology. For example, changing
Flower's start from Wednesday to Tuesday adjusts both the preceding phase's
duration and Flower's duration. Editing a phase entry in an ended grow leaves that
grow ended and uses its recorded end timestamp as the final duration boundary.

### Phase-change prompt after schedule loading

Offer a phase-change prompt after firmware confirms loading a first or different
schedule template. Reloading the same template or loading a newer revision of it
does not trigger the prompt. Compare template identity, not its display name, to
distinguish a template switch from an update or reload.

For an active grow, offer `Log phase change` or `Keep current phase`. Recording a
phase requires an explicit phase choice and saving the entry; keeping the current
phase or dismissing the prompt leaves the journal unchanged. Every confirmed load
still appears in Recent activity, including reloads and revision updates that do
not prompt for a phase change. Pending or unsuccessful loads cannot create a phase
change, and a schedule load never changes the journal's phase automatically.

### Schedule-load follow-up without an active grow

When a qualifying confirmed schedule load has no active grow, offer `Start grow`
or `Not now`. Starting collects a grow name, an initial phase (default or custom),
and an editable actual start date/time so a crop already underway can be recorded.
`Not now` or dismissal leaves the schedule loaded without creating a grow or any
journal entries. Saving the grow is a separate journal action; it does not load or
change the schedule again. The journal also needs a direct Start grow entry point
so starting a grow does not depend on switching schedules.

### Duration display

Use a Days / Weeks switch for grow and phase durations. Weeks displays whole weeks
plus remaining days: the same duration reads `17 days` or `2 weeks 3 days`, rather
than decimal weeks. Actual date/time stamps remain visible in either view. Remember
the selection across devices and visits in the same browser, following the existing
temperature-unit preference pattern. Switching the display never changes stored
timestamps or how phase boundaries are calculated.

### Collapsible dashboard sections

Device controls stays expanded and is not collapsible. Schedule deployment,
outlet setup, Sensor history, Grow journal, Recent activity, and History samples
are collapsible. Live sensor readings, device status, and warnings stay visible.

Default to expanded for all collapsible sections except History samples, which
starts collapsed. Remember expand/collapse choices per device in the browser.
Collapsing a section preserves its form contents and selected filters, and both
keyboard and pointer controls must work.

### Automatic management-address reporting

The device establishes the connection to the MQTT broker. Firmware must report its
current station address through that connection so Command Center learns address
changes automatically and updates the management button for the same MAC-identified
device. A manually maintained address is not the selected approach.

Implementation approach: add an optional, versioned, retained MQTT network-state
message with QoS 1. Firmware publishes its current address on MQTT connection or
reconnection and when its station address changes; if MQTT is unavailable, publish
the latest address after reconnecting. The server validates and mirrors the address
and exposes a management link through the existing device API. The next successful
dashboard poll picks up the new link without a page reload. Opening it uses a new
tab. Device identity and grow history remain keyed by MAC, independent of address.

Retained address data lets Command Center recover the last reported address after
its own restart. An address is not proof of device presence or browser reachability;
keep those distinctions and label an offline address as last reported. Older firmware
without this optional message continues to support its existing workflows, with the
management button unavailable until an address is reported. The new optional state
must not become a required retained-state readiness blocker for older devices.

The current firmware already exposes `wifi_get_sta_ip()`, handles
`IP_EVENT_STA_GOT_IP`, and republishes retained state on `MQTT_EVENT_CONNECTED`.
Espressif documents address-change notifications in its
[Wi-Fi event guide](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32/api-guides/wifi.html#ip-event-sta-got-ip)
and connection events/retained publishing in its
[MQTT API](https://docs.espressif.com/projects/esp-idf/en/v5.3.5/esp32/api-reference/protocols/mqtt.html).
Implementation must handle socket reconnection on a changed address and defer network
work from the Wi-Fi event handler. The additive contract needs documentation in both
repositories and must be distinguished from the frozen CE 1.1.0C baseline.

### Address changes in Recent activity

Record one Recent activity entry when a known management address changes, showing
the previous and new addresses and when Command Center observed the change. First
address discovery is not an address change. Duplicate deliveries, retained replay,
and reconnects reporting the same address do not create extra entries. Address
changes do not appear in Grow journal, and observing an address change does not
create a new device or alter existing grow history.

### Journal summary, quick-add, and filters

Include a compact summary showing the current phase, time spent in that phase,
and total grow age. It follows the agreed Days / Weeks preference and keeps the
relevant date/time stamps visible. For an ended grow, use its recorded end as the
duration boundary rather than continuing to increase its age.

Provide quick-add buttons for Note, Nutrients, pH adjustment, and Training, opening
the journal entry form with the chosen type already selected. Users can filter
entries by type, including phase changes. Filtering the entry list does not change
the phase timeline, its duration calculations, or the grow summary.

## Acceptance criteria

- [x] AC1: While the dashboard is visible, each device poll refreshes the selected
  sensor-history window without a page reload. Device/range changes cannot accept
  stale responses, and history failures preserve the existing chart and controls.
- [x] AC2: Firmware reports its current management address over MQTT on connection,
  reconnection, and address changes. Command Center updates the selected device's
  management link on its next successful dashboard poll, with no manual address
  maintenance or hardcoded bench address. MAC identity and history survive address
  changes. The link opens in a new tab; unknown addresses have an understandable
  unavailable state, and older firmware remains usable without the optional report.
- [x] AC3: Temperature and humidity show the minimum, maximum, and low-to-high
  range of valid underlying readings within exactly the selected period. Values
  follow the temperature-unit preference and handle no/partial data correctly.
- [x] AC4: Schedule deployment, outlet setup, Sensor history, Grow journal, Recent
  activity, and History samples collapse and expand by keyboard and pointer without
  losing form contents or selected filters. Only History samples defaults to
  collapsed; choices persist per device in the browser. Device controls stays
  expanded with no collapse control. Live sensor readings, status, and warnings
  remain visible.
- [x] AC5: The lower dashboard order is Sensor history → Grow journal → Recent
  activity → History samples, with History samples at the bottom.
- [x] AC6: Device online/offline transitions and observed management-address
  changes appear in Recent activity and are excluded from Grow journal. Address
  changes show the old and new addresses and observation timestamp. First address
  discovery and unchanged reports create no address-change entries; duplicate
  deliveries and reconnects create no duplicate activity. Existing records remain
  available without duplicate rendering.
- [x] AC7: The journal shows ongoing and completed phase durations in days or weeks,
  with weeks plus remaining days (17 days ↔ 2 weeks 3 days), retaining visible
  date/time stamps and remembering the selected unit in the browser. Each named
  grow has a separate phase timeline;
  phases may be skipped or revisited, with each occurrence keeping its own dates
  and duration. Users can choose Seedling, Veg, Flower, Flush, or Harvest, or add a
  custom phase name with the same timeline behavior. Calculations are independent
  of the chart's selected period or event-list limit. Phase names and actual
  timestamps remain editable in active and ended grows; backdating or correcting
  entries recalculates affected durations without reopening an ended grow.
- [x] AC8: Loading a first or different schedule template offers an optional
  phase-change entry after firmware confirmation, with an explicit phase choice.
  Keep current phase or dismissal leaves the journal unchanged. Reloading or
  updating the same template does not prompt. Unconfirmed attempts cannot create
  a phase change, and one confirmed load cannot create duplicate phase entries.
  With no active grow, the follow-up offers Start grow or Not now; dismissal or
  Not now creates no grow or journal entry and leaves the confirmed schedule loaded.
- [x] AC9: A confirmed schedule load appears in Recent activity with the template
  name, timestamp, and outcome without a page reload. Other outcomes remain accurately
  labeled; loading while MANUAL does not imply automation has resumed.
- [x] AC10: A device has at most one active named grow. Past grows and their entries
  remain available, and existing entries survive migration as unassigned history
  without guessed grow membership or changed timestamps. Users can explicitly
  assign selected unassigned entries to a grow on the same device without changing
  their contents or timestamps, including phase entries in its timeline. Start grow records the
  name, initial phase, and editable actual start date/time independently of schedule
  loading, including for a crop already underway. Only an explicit End grow
  action finishes a grow, preserving its end timestamp and stopping its duration
  and final-phase duration there. Entering Harvest alone keeps the grow active;
  ending the grow sends no device commands.
- [x] AC11: The journal includes a compact current-phase, phase-duration, and
  total-grow-age summary; quick-add buttons for Note, Nutrients, pH adjustment,
  and Training; and entry-type filters including phase changes. The summary follows
  the Days / Weeks preference and the grow's actual timestamps, and remains
  independent of entry-list filtering.

## Implementation TODO

- [x] Add grow persistence, validated journal APIs, and legacy-entry assignment.
- [x] Add accurate history extrema and coordinate dashboard polling.
- [x] Mirror optional firmware network state and unify operational activity.
- [x] Implement collapsible sections and journal workflows.
- [x] Preserve prompt eligibility and prevent duplicates across late confirmation
  and page navigation; cover all schedule-load entry points.
- [x] Add firmware address reporting and document the additive contract.
- [x] Run automated verification and record live-device evidence or limitations.

- [x] Finish AC2 on hardware: the user changed the selected controller’s DHCP address and reconnected it. Verified its new retained report, same identity, reachable management page, exactly one address-change event in the isolated mirror, and no duplicate after mirror/database restart. See the verification record for test boundaries.

## Verification strategy and planned commands

Run from `/Users/ben/projects/Growhub-Command-Center` after implementation:

```bash
npm run lint
npm run format:check
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run test:a11y
git diff --check
```

Firmware checks, from `/Users/ben/projects/Growhub-CE-Firmware`:

```bash
scripts/build-verified-firmware.sh
git diff --check
```

- AC1–AC3: API tests cover exact window boundaries, null sensor values, spikes
  hidden by averaging, and empty results. Browser checks deliver new readings
  while the page stays open and switch device/range during delayed requests.
- AC4–AC5: Browser checks cover section order, keyboard expansion, small screens,
  retained form state, History samples collapsed by default, other sections expanded
  by default, and per-device preference persistence. Verify that Device controls
  has no collapse control and remains visible alongside live readings and status.
- AC6 and AC9: MQTT/API tests cover duplicate deliveries, presence transitions,
  confirmed and unsuccessful schedule actions, historical records, ordering,
  and immediate UI refresh. Verify exactly one activity entry for a known address
  changing, including after Command Center restarts, with old/new addresses and
  observation time. First address discovery, identical retained replay, and
  reconnecting with the same address produce no address-change entries.
- AC7–AC8: Deterministic time tests cover completed/current durations, days/weeks,
  skipped phases, repeated phases as distinct segments, custom phase names, backdated
  changes, and corrected chronology in active and ended grows; browser tests cover
  default/custom phase entry, editing an ended grow without reopening it, the
  optional prompt, dismissal, errors, and duplicate prevention. Verify weeks plus
  remaining days, the browser-persisted unit preference across devices, and visible
  timestamps in both views.
- AC10: Migration tests preserve existing entry content and timestamps; server tests
  enforce one active grow per device, including concurrent start attempts, and verify
  isolation between current and past grow timelines. Verify that Harvest does not
  end a grow, an explicit end freezes durations at its timestamp, and ending a grow
  does not publish MQTT or mutate firmware-owned state. Browser tests cover Start
  grow from the journal and from a qualifying schedule-load follow-up, including
  backdated starts and Not now without any grow or journal mutation.
- AC11: Browser tests verify all four quick-add buttons preselect the correct entry
  type and save to the intended grow, entry filters select the expected rows, and
  filtering leaves the summary and phase durations unchanged. Verify the summary
  updates elapsed time for an active grow and uses a fixed end boundary for an
  ended grow in either duration unit.
- AC2: MQTT/API tests cover initial address reports, address replacement for the
  same MAC, duplicate delivery, malformed addresses, retained replay after Command
  Center restart, reconnect after an address change while disconnected, and older
  firmware without the optional state. Browser tests verify the link changes while
  the page stays open. Validate against an actual device after a controlled DHCP
  address change and MQTT reconnect, confirming its new page opens and its identity,
  schedules, and grow history persist. Local tests will not be described as
  live-device verification.

Initial inspection found a clean Command Center worktree. Implementation and verification results, resolved failures, and the remaining hardware check are recorded in [the verification evidence](DASHBOARD-JOURNAL-VERIFICATION.md).
