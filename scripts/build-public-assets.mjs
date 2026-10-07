#!/usr/bin/env node
// 사용법: node packages/cli/scripts/build-public-assets.mjs <출력 디렉토리>   (예: apps/web/public)
//
// web 이 정적으로 서빙할 파일을 만든다(web 빌드에서 호출할 예정).
//   <출력>/.well-known/agent-skills/…   → npx skills add https://bizbell.site
//   <출력>/cli/bizbell.tgz              → npx -y https://bizbell.site/cli/bizbell.tgz <명령>
//   <출력>/cli/bizbell-<버전>.tgz       → 버전 고정용
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSkillsIndex } from './build-skills-index.mjs'

if (!process.argv[2]) {
  console.error('사용법: node build-public-assets.mjs <출력 디렉토리>')
  process.exit(2)
}
const outDir = resolve(process.argv[2])
const pkgDir = fileURLToPath(new URL('..', import.meta.url))

buildSkillsIndex(outDir)

const tmp = mkdtempSync(join(tmpdir(), 'bizbell-pack-'))
try {
  const [{ filename, version }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: pkgDir, encoding: 'utf8' }),
  )
  mkdirSync(join(outDir, 'cli'), { recursive: true })
  // 2026-10-02 이전에 설치된 스킬은 bizbell-0.1.0.tgz 를 이름으로 부른다 — 버전을 올려도 그 이름으로 최신본을 계속 둔다.
  const names = new Set(['bizbell.tgz', `bizbell-${version}.tgz`, 'bizbell-0.1.0.tgz'])
  for (const name of names) copyFileSync(join(tmp, filename), join(outDir, 'cli', name))
  console.log(`→ ${join(outDir, 'cli', 'bizbell.tgz')} (${version})`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
