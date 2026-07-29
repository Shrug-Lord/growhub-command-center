import assert from 'node:assert/strict'
import test from 'node:test'

import { detailsForDriftEpisode } from '../../src/utils/driftState.js'

test('reuses drift details only for the active episode', () => {
  const details = { episode: { id: 'episode-1' }, firmware: { fingerprint: 'current' } }

  assert.equal(detailsForDriftEpisode(details, 'episode-1'), details)
  assert.equal(detailsForDriftEpisode(details, 'episode-2'), null)
})

test('does not reuse incomplete drift details', () => {
  assert.equal(detailsForDriftEpisode(null, 'episode-1'), null)
  assert.equal(detailsForDriftEpisode({}, 'episode-1'), null)
  assert.equal(detailsForDriftEpisode({ episode: { id: 'episode-1' } }, null), null)
})
