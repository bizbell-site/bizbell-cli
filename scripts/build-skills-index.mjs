#!/usr/bin/env node
// 사용법: node packages/cli/scripts/build-skills-index.mjs <출력 디렉토리>
//
// `npx skills add https://bizbell.site` 가 읽는 well-known 인덱스를 만든다.
//   <출력>/.well-known/agent-skills/index.json
//   <출력>/.well-known/agent-skills/<스킬>/SKILL.md
// 형식은 vercel-labs/skills 의 src/providers/wellknown.ts (discovery v0.2.0, type "skill-md")를 따른다.
// digest 는 SKILL.md 바이트의 sha256 이라 서버가 파일을 바꾸지 않고 그대로 서빙해야 한다.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url))
export const DISCOVERY_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'

/** SKILL.md frontmatter 의 name·description 만 읽는다(한 줄 값과 `>-` 접힌 블록). @param {string} md */
export function frontmatter(md) {
  const block = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  /** @type {Record<string, string>} */
  const out = {}
  let key = ''
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (kv) out[(key = kv[1])] = /^[>|]-?$/.test(kv[2]) ? '' : kv[2].replace(/^(["'])(.*)\1$/, '$2')
    else if (key && /^\s/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim()
  }
  return out
}

/** @param {string} outDir */
export function buildSkillsIndex(outDir) {
  const base = join(outDir, '.well-known', 'agent-skills')
  const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((dir) => {
      const bytes = readFileSync(join(SKILLS_DIR, dir, 'SKILL.md'))
      const { name, description } = frontmatter(bytes.toString('utf8'))
      // wellknown.ts isValidSkillName/isValidSkillEntryV2 와 같은 규칙
      if (name !== dir || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
        throw new Error(`${dir}/SKILL.md: name 은 디렉토리 이름과 같고 소문자·숫자·하이픈(1~64자)이어야 합니다.`)
      }
      if (!description || description.length > 1024) throw new Error(`${dir}/SKILL.md: description 은 1~1024자여야 합니다.`)
      mkdirSync(join(base, name), { recursive: true })
      writeFileSync(join(base, name, 'SKILL.md'), bytes)
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
      return { name, type: 'skill-md', description, url: `${name}/SKILL.md`, digest }
    })
  writeFileSync(join(base, 'index.json'), `${JSON.stringify({ $schema: DISCOVERY_SCHEMA, skills }, null, 2)}\n`)
  return skills
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('사용법: node build-skills-index.mjs <출력 디렉토리>')
    process.exit(2)
  }
  const outDir = resolve(process.argv[2])
  for (const s of buildSkillsIndex(outDir)) console.log(`${s.name}  ${s.digest}`)
  console.log(`→ ${join(outDir, '.well-known', 'agent-skills', 'index.json')}`)
}
