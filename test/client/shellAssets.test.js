import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('application shell declares and packages the bundled Growhub favicon', async () => {
  const [html, favicon, dockerfile] = await Promise.all([
    readFile(new URL('../../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../../public/favicon.svg', import.meta.url), 'utf8'),
    readFile(new URL('../../deploy/server/Dockerfile', import.meta.url), 'utf8'),
  ])

  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/)
  assert.match(favicon, /<svg[^>]+viewBox="0 0 64 64"/)
  assert.match(dockerfile, /^COPY public\/ \.\/public\/$/m)
})
