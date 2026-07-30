import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function validateEvidence({ label, content, requiredFields }) {
  const failures = []
  if (!/^Status: passed$/m.test(content)) {
    failures.push(label + ' is not marked passed.')
  }
  if (/^- \[ \]/m.test(content)) {
    failures.push(label + ' still has unchecked items.')
  }
  for (const field of requiredFields) {
    const fieldPattern = new RegExp('^- ' + escapeRegExp(field) + ': (?:pending|\\s*)$', 'm')
    if (fieldPattern.test(content)) {
      failures.push(field + ' is missing from ' + label + '.')
    }
  }
  return failures
}

export function validateReleaseReadiness({
  tag,
  packageVersion,
  serverVersion,
  evidenceDocuments,
}) {
  const failures = []
  if (!tag) failures.push('Set RELEASE_TAG or GITHUB_REF_NAME to the release tag.')
  if (tag && tag !== 'v' + packageVersion) {
    failures.push('Release tag ' + tag + ' does not match package version v' + packageVersion + '.')
  }
  if (serverVersion !== packageVersion) {
    failures.push('Root and server package versions do not match.')
  }
  for (const evidence of evidenceDocuments) {
    failures.push(...validateEvidence(evidence))
  }
  return failures
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const serverPackage = JSON.parse(
    fs.readFileSync(path.join(root, 'deploy', 'server', 'package.json'), 'utf8'),
  )
  const evidenceDocuments = [
    {
      label: 'CE 1.1.0C hardware evidence',
      content: fs.readFileSync(path.join(root, 'docs', 'release-evidence', 'CE-1.1.0C.md'), 'utf8'),
      requiredFields: [
        'Command Center commit',
        'CE firmware commit',
        'Broker/version',
        'Device hardware',
        'Tested by',
        'Tested at',
      ],
    },
    {
      label: 'host compatibility evidence',
      content: fs.readFileSync(
        path.join(root, 'docs', 'release-evidence', 'HOST-COMPATIBILITY.md'),
        'utf8',
      ),
      requiredFields: [
        'Command Center commit',
        'Reference Raspberry Pi',
        'Docker Engine/Compose',
        'Tested by',
        'Tested at',
      ],
    },
    {
      label: 'accessibility spot-check evidence',
      content: fs.readFileSync(
        path.join(root, 'docs', 'release-evidence', 'ACCESSIBILITY-v0.1.0.md'),
        'utf8',
      ),
      requiredFields: ['Command Center commit', 'Release host', 'Tested by', 'Tested at'],
    },
  ]
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME
  const failures = validateReleaseReadiness({
    tag,
    packageVersion: packageJson.version,
    serverVersion: serverPackage.version,
    evidenceDocuments,
  })

  if (failures.length > 0) {
    process.stderr.write(
      'Release readiness failed:\n' + failures.map((item) => '- ' + item).join('\n') + '\n',
    )
    process.exitCode = 1
  } else {
    process.stdout.write('Release readiness passed for ' + tag + '.\n')
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) main()
