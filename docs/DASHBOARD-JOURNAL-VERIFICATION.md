# Dashboard and grow journal verification

Date: 2026-09-07. Scope: [agreed plan](DASHBOARD-JOURNAL-PLAN.md), AC1–AC11.
Status: AC1–AC11 verified, including a physical DHCP address change after the
selected controller reconnected. Changes are uncommitted.
Command Center was tested against isolated temporary databases, not deployed to the
live installation. The selected bench controller received the development firmware.

## Acceptance evidence

| Criteria | Evidence | Result |
| --- | --- | --- |
| AC1 | A new fixture reading appeared on the next visible-device poll without reload. A failed history request preserved the chart and device controls; Retry restored the requested range. Delayed seven-day responses could not overwrite newer one-hour or different-device selections. | Pass |
| AC2 | Built and uploaded the firmware, observed the real retained QoS 1 network report, and rebuilt the correct management URL through the actual Command Center MQTT/parser/device-view code. Browser fixture links updated without reload, opened in a new tab, and older-firmware unavailable state remained usable. After the user changed the physical controller’s DHCP address and reconnected it, the real retained report carried the new address. The test mirror updated the same device, recorded one change, preserved fixture journal rows, and created no duplicate after database/mirror restart. | Pass |
| AC3 | API tests cover raw extrema hidden by bucket averages, exact inclusive window boundaries, empty and null readings. Browser showed updated low/high/span and verified Fahrenheit conversion (14–31.5 °C became 57.2–88.7 °F, span 31.5 °F). | Pass |
| AC4–5 | Keyboard Enter/Space collapsed and expanded the journal without losing a draft. Preferences survived reload and remained separate across devices. Only samples starts collapsed. Device control has no collapse button. Lower heading order is history, journal, activity, samples. Desktop and 390-pixel mobile screenshots were inspected. | Pass |
| AC6 | MQTT and migration tests separate presence and operational history from manual journal entries. Browser initial address plus changed address plus duplicate replay produced one address-change row with old/new addresses, and no operational rows in the journal. | Pass |
| AC7 | Server tests cover skipped/revisited/custom phases and corrected ended timelines. Browser verified 17 days ↔ 2 weeks 3 days, dated custom phases, persistent/shared duration preference, and editing an ended phase without reopening the grow. | Pass |
| AC8 | Tests cover distinct identities, same-template revisions/reloads, late confirmation, duplicate observations, and atomic save/resolution. Browser verified the global prompt on Schedules, persistence after reload, Not now without grow changes, and Start grow with an explicitly selected phase. | Pass |
| AC9 | Recent activity displays confirmed template names/outcomes, using completion time where available. Existing action tests cover unconfirmed/unsuccessful outcomes and firmware-owned mode. | Pass |
| AC10 | Migration and API/service tests preserve legacy entries, enforce one active grow, and verify End grow emits no MQTT command. Browser verified explicit end, subsequent correction, and assignment of a legacy phase preserving its millisecond timestamp and notes. | Pass |
| AC11 | Browser verified all four quick-add types saved correctly. Filtering to training returned the expected entry without changing the phase timeline or summary. | Pass |

## Automated checks

Node 24.18.0 was selected via the Homebrew Node 24 PATH because the system Node
major differs from the repository’s declared engine. No new dependencies were added.

Commands run from the Command Center repository:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run lint
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run format:check
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run test:integration
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run build
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run test:e2e
git diff --check
```

- Full suite: 119 server tests and 38 client tests passed.
- Explicit integration suite: 38 tests passed (overlaps server coverage).
- Browser suite: 1 test passed on the final build (4.0 seconds including build/server startup). Its existing test includes both `@smoke` and `@a11y`; it was not redundantly rerun under a second tag.
- Final browser assets build, lint, formatting check, and whitespace checks passed.
- The final CSS-only mobile fixes were checked visually, then lint/format and the
  browser suite were rerun; the unchanged server/client tests were not repeated.

Focused regression command also run:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH node --test deploy/server/test/apiContracts.test.js deploy/server/test/scheduleTemplates.test.js
```

Browser interaction used the Playwright skill and global CLI with a short session
and temporary socket root:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH node /tmp/growhub-qa-server.cjs
TMPDIR=/tmp PATH=/opt/homebrew/opt/node@24/bin:$PATH playwright-cli -s=gh open http://127.0.0.1:4174 --headed
TMPDIR=/tmp PATH=/opt/homebrew/opt/node@24/bin:$PATH playwright-cli -s=gh snapshot --filename=/tmp/gh-snapshot.yml
TMPDIR=/tmp PATH=/opt/homebrew/opt/node@24/bin:$PATH playwright-cli -s=gh close
```

The temporary wrapper reused `deploy/server/test-support/e2eServer.js`, logging its
fresh database path so measurements/network/legacy entries could be injected only
into that fixture. CLI `run-code` exercised observed form controls, authenticated
fixture schedule loads, delayed HTTP responses, and screenshot/viewport assertions.
Private production MQTT commands were never used for journal or schedule UI tests.

Local, gitignored screenshot artifacts:

- `output/playwright/dashboard-enhancements-desktop.png`
- `output/playwright/dashboard-enhancements-mobile.png`
- `output/playwright/journal-enhancements-mobile.png`

The application scrolls its `main` container. Screenshots were positioned within
that container; whole-document captures do not expose its entire scrollable content.

## Firmware and live broker evidence

Commands run from the firmware repository:

```sh
scripts/build-verified-firmware.sh
git diff --check
shasum -a 256 firmware/.pio/build/growhub/firmware.bin
```

Uploaded application image:

```text
firmware/.pio/build/growhub/firmware.bin
SHA-256 35e103946171d0cd189d639d9d95688a4b4ff7748be6845b7190244ac3a58ff0
```

The image retains development version label `1.1.0C`; the optional network report
is explicitly documented as an unreleased extension beyond the frozen baseline.
The build includes pre-existing working-tree changes to HTTPS OTA certificate-bundle
support; those changes were preserved and are not attributed to this enhancement.
No tagged release or clean-commit provenance is claimed.

Network-command record (private target values replaced by variables):

```sh
curl --max-time 10 --fail -sS "http://${BENCH_IP}/status"
curl --fail --max-time 120 -H 'Content-Type: application/octet-stream' --data-binary @firmware/.pio/build/growhub/firmware.bin "http://${BENCH_IP}/ota_upload"
```

The upload returned `OK`. Post-update `/status` showed the same device name/MAC,
Wi-Fi/MQTT connected, valid SNTP time, no warnings, AUTO mode, and all four outlets
off. Its saved outlet assignments and inactive schedule remained unchanged. A
second health read over five hours later confirmed continued healthy operation.

A read-only MQTT subscriber observed the following sanitized retained payload:

```json
{"v":1,"ip":"192.0.2.10","http_port":80}
```

A separate temporary Command Center MQTT mirror subscribed only to the selected
device’s topics. Its readiness became `ready`, its management URL matched the
reported address, and first discovery emitted zero address-change events. No
production application database was mutated for verification.

### Completed physical DHCP check

At 19:10 UTC, after the user changed the selected controller’s DHCP address and
reconnected it, the real broker delivered a retained QoS 1 report containing the
new address. The management homepage returned HTTP 200 (`text/html`), and `/status`
returned the same MAC/name, healthy Wi-Fi/MQTT, valid time, AUTO mode, all outlets
off, and no warnings. The firmware-owned schedule mirror remained inactive.

The previous in-memory bench monitor had been stopped before the address change.
For this follow-up, an isolated on-disk test database was seeded with the previous
address from that monitor’s saved observation and temporary grow/journal rows.
The actual Command Center MQTT service then consumed the new real retained report:

- The same MAC remained the only device, with its management URL updated.
- One operational event contained the previously observed and newly reported addresses.
- The temporary grow and entry rows were byte-for-byte unchanged.
- Closing/reopening the database and reconnecting the mirror replayed current
  retained state without adding a second address-change event.

The temporary subscriber and database were cleaned up. No live Command Center
database was changed. Browser link refresh had already passed against the isolated
UI fixture. This physical test exercised a changed address after reboot/reconnect;
it did not force an in-place DHCP lease replacement on a still-connected socket.

Additional verification command (private target arguments represented by variables):

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH node /tmp/growhub-dhcp-check.cjs "$BENCH_MAC" "$BROKER_URL" "$NEW_BENCH_IP"
```

Both assertions groups passed: actual DHCP report/management identity, and retained
replay after mirror/database restart. Local raw results: `/tmp/growhub-dhcp-check.log`.
No private bench addresses or full MACs are committed in this evidence document.

## Resolved failure tickets

| Failure | Command/check | Root cause and fix |
| --- | --- | --- |
| Startup tests failed with `db.transaction is not a function` | `npm test` | Eager journal initialization touched intentionally minimal bootstrap database doubles. Journal service now initializes lazily when needed; full suite passes. |
| Address change used an invalid MQTT reconnect state | Pinned ESP-MQTT source/API review | `reconnect()` requires a client waiting to reconnect. Firmware now requests asynchronous disconnect, allowing automatic reconnect to replace the old socket. See [Espressif MQTT API](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32/api-reference/protocols/mqtt.html). Build, initial reporting, and the physical DHCP/reconnect test pass. In-place lease replacement while the socket remains connected was not forced. |
| Immediate End grow rejected its latest entry | Browser quick-add → End grow | The visible second-resolution field truncated milliseconds. Untouched entry/end values now retain original timestamps; deterministic regression and browser end/edit checks pass. |
| Expanded samples overflowed mobile; grow selector was cramped | Mobile `main.scrollWidth > main.clientWidth` plus screenshots | Samples toolbar now wraps; grow selector occupies its own row on narrow screens. Main-container width assertion and inspected screenshots pass. |
| Two new test fixtures failed | Focused API tests | Test used `measurements` instead of `sensor_measurements` and PUT instead of the actual PATCH entry route. Corrected harness; focused suite passes. |
| Browser harness could not start or prepare data | Playwright CLI checks | Long macOS socket path fixed with `TMPDIR=/tmp` and `-s=gh`. Fixture HTTP requests need absolute URLs; directly reading session during setup rotates CSRF, so browser was reloaded before form writes. These were harness issues, not product fixes. |

Expected synthetic HTTP failures were observed only during error-handling tests.
No unexpected runtime exception was observed in the final normal browser flows.
