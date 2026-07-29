import assert from 'node:assert/strict'
import test from 'node:test'
import { validateEvidence, validateReleaseReadiness } from '../../scripts/release-readiness.js'

const completeEvidence = {
  label: 'test evidence',
  content: `Status: passed

- Commit: abc123
- Tested by: Operator

- [x] Check completed.
`,
  requiredFields: ['Commit', 'Tested by'],
}

test('release readiness accepts matching versions and complete evidence', () => {
  assert.deepEqual(
    validateReleaseReadiness({
      tag: 'v0.1.0',
      packageVersion: '0.1.0',
      serverVersion: '0.1.0',
      evidenceDocuments: [completeEvidence],
    }),
    [],
  )
})

test('release readiness reports tag, version, and every evidence document failure', () => {
  const failures = validateReleaseReadiness({
    tag: 'v0.2.0',
    packageVersion: '0.1.0',
    serverVersion: '0.0.9',
    evidenceDocuments: [
      completeEvidence,
      {
        label: 'host evidence',
        content: 'Status: pending\n\n- Host: pending\n\n- [ ] Rehearse restore.\n',
        requiredFields: ['Host'],
      },
    ],
  })

  assert.deepEqual(failures, [
    'Release tag v0.2.0 does not match package version v0.1.0.',
    'Root and server package versions do not match.',
    'host evidence is not marked passed.',
    'host evidence still has unchecked items.',
    'Host is missing from host evidence.',
  ])
})

test('evidence fields reject empty values as well as pending markers', () => {
  assert.deepEqual(
    validateEvidence({
      label: 'hardware evidence',
      content: 'Status: passed\n\n- Commit:   \n- Device: pending\n',
      requiredFields: ['Commit', 'Device'],
    }),
    ['Commit is missing from hardware evidence.', 'Device is missing from hardware evidence.'],
  )
})
