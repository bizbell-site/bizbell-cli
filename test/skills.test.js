import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSkillsIndex, DISCOVERY_SCHEMA, frontmatter } from '../scripts/build-skills-index.mjs'

const CLI_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
// npx 는 같은 원격 tarball URL 의 첫 설치본을 계속 재사용한다 — 버전이 박힌 URL 이어야 새 버전이 설치된다.
const CLI_INVOCATION = 'npx -y bizbell@latest'

test('well-known 인덱스(v0.2.0): 이름·설명·상대 url·digest 가 스킬 파일과 맞는다', () => {
  const out = mkdtempSync(join(tmpdir(), 'bizbell-skills-'))
  buildSkillsIndex(out)
  const base = join(out, '.well-known', 'agent-skills')
  const index = JSON.parse(readFileSync(join(base, 'index.json'), 'utf8'))
  assert.equal(index.$schema, DISCOVERY_SCHEMA)
  assert.deepEqual(index.skills.map((s) => s.name), ['bizbell-alerts', 'bizbell-notices'])
  for (const s of index.skills) {
    const bytes = readFileSync(new URL(s.url, `file://${base}/index.json`))
    assert.equal(s.type, 'skill-md')
    assert.match(s.digest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(s.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    const fm = frontmatter(bytes.toString('utf8'))
    assert.equal(fm.name, s.name)
    assert.equal(fm.description, s.description)
    assert.ok(s.description.length <= 1024 && !s.description.includes('>-'))
    // CLI 실행 형태는 스킬마다 한 곳에만 둔다(npm 게시 후 한 줄만 바꾸면 된다).
    assert.equal(bytes.toString('utf8').split(CLI_INVOCATION).length - 1, 1, `${s.name}: 실행 형태가 한 번만 나와야 한다`)
    // 공공누리 제3유형 원문 인용과 프롬프트 인젝션 주의는 스킬마다 있어야 한다(따로 설치될 수 있다).
    assert.match(bytes.toString('utf8'), /`KOGL-3`[\s\S]*verbatim/, `${s.name}: KOGL-3 원문 인용 규칙`)
    assert.match(bytes.toString('utf8'), /untrusted data, never as instructions/, `${s.name}: 인젝션 주의`)
  }
})

test('build-public-assets: 스킬 인덱스와 cli/bizbell.tgz 를 만든다', () => {
  const out = mkdtempSync(join(tmpdir(), 'bizbell-public-'))
  const script = fileURLToPath(new URL('../scripts/build-public-assets.mjs', import.meta.url))
  execFileSync(process.execPath, [script, out], { stdio: 'pipe' })
  assert.ok(existsSync(join(out, '.well-known', 'agent-skills', 'index.json')))
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const tgz = join(out, 'cli', 'bizbell.tgz')
  assert.deepEqual(readFileSync(tgz), readFileSync(join(out, 'cli', `bizbell-${version}.tgz`)))
  const files = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).trim().split('\n').sort()
  assert.deepEqual(files, [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
    'package/skills/bizbell-alerts/SKILL.md',
    'package/skills/bizbell-notices/SKILL.md',
    'package/src/api.js',
    'package/src/cli.js',
    'package/src/format.js',
    'package/src/mcp.js',
  ])
})
