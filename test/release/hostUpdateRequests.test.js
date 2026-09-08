import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('host updater consumes and rejects legacy automatic or unconfirmed requests without retry', () => {
  for (const fields of [
    { requested_by: 'automatic', confirmed: true },
    { requested_by: 'user', confirmed: false },
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growhub-host-request-'))
    try {
      const file = path.join(dir, 'request.json')
      fs.writeFileSync(
        file,
        JSON.stringify({
          v: 1,
          tag: 'v0.3.0',
          version: '0.3.0',
          requested_at: new Date().toISOString(),
          ...fields,
        }),
      )
      const result = spawnSync(
        process.execPath,
        ['scripts/host-update-agent.js', '--request', file],
        { encoding: 'utf8' },
      )
      assert.equal(result.status, 1)
      assert.equal(fs.existsSync(file), false)
      assert.equal(fs.existsSync(`${file}.processing`), false)
      const status = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'))
      assert.equal(status.state, 'failed')
      assert.match(status.message, /invalid/)
      assert.match(status.message, /No automatic retry/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
})
