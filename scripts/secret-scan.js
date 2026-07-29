import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
if (result.error) throw result.error
if (result.status !== 0)
  throw new Error('Unable to enumerate repository files for secret scanning.')

const forbiddenFiles = [
  /(^|\/)\.env$/,
  /\.(?:db|db-shm|db-wal)$/,
  /(^|\/)deploy\/server\/data\//,
  /(^|\/)dist\//,
]
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
]
const browserContractPatterns = [
  ['browser MQTT dependency', /from\s+['"]mqtt['"]|require\(['"]mqtt['"]\)/],
  ['firmware HTTP time endpoint', /\/savetime\?epoch=/],
  ['generic MQTT publish API', /\/api\/(?:v1\/)?(?:mqtt\/)?publish\b/],
  ['browser bearer-token storage', /localStorage\.(?:setItem|getItem)\([^)]*(?:token|auth)/i],
]
const findings = []

for (const relative of result.stdout.split('\0').filter(Boolean)) {
  if (forbiddenFiles.some((pattern) => pattern.test(relative))) {
    findings.push(`${relative}: forbidden runtime or secret-bearing file`)
    continue
  }
  const absolute = path.join(root, relative)
  const stat = fs.statSync(absolute, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size > 5_000_000) continue
  const content = fs.readFileSync(absolute, 'utf8')
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) findings.push(`${relative}: possible ${label}`)
  }
  if (relative.startsWith('src/')) {
    for (const [label, pattern] of browserContractPatterns) {
      if (pattern.test(content)) findings.push(`${relative}: ${label}`)
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Security scan failed:\n${findings.map((entry) => `- ${entry}`).join('\n')}\n`,
  )
  process.exitCode = 1
} else {
  process.stdout.write(
    'Security scan passed: no forbidden artifacts or recognized secret patterns.\n',
  )
}
