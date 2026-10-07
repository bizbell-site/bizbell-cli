#!/usr/bin/env node
// @ts-check
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import {
  api,
  BizbellError,
  CLI_BASE,
  credentialsPath,
  deleteKey,
  request,
  resolveKey,
  saveKey,
  SITE,
  usageError,
  VERSION,
} from './api.js'
import { ALERT_COLUMNS, FAVORITE_COLUMNS, NOTICE_COLUMNS, pickFormat, print } from './format.js'
import { serveMcp } from './mcp.js'

const HELP = `bizbell ${VERSION} — 한국 정부지원·입찰 공고 API CLI

사용법: bizbell <명령> [옵션]

인증
  login [--api-key <키>|-] [--no-browser]   구글 계정으로 로그인해 API 키를 저장합니다
  logout                                    저장한 API 키를 지웁니다
  whoami                                    로그인 상태·플랜을 봅니다
  usage                                     이번 달 사용량을 봅니다

공고
  search [검색어] [-c startup|bid|support|rnd]... [--source S]... [--region 서울]...
         [--org 기관] [--status open|upcoming|closed|all] [--deadline-within N]
         [--deadline-after N] [--always-open] [--budget-min 원] [--budget-max 원]
         [--published-since ISO] [--updated-since ISO]
         [--sort published_desc|deadline_asc|updated_desc|budget_desc]
         [--limit 20] [--cursor C] [--fields id,title,...]
  show <공고ID> [--open]

즐겨찾기 (구글 로그인 필요)
  fav ls [--status active|expired|all] [--limit N] [--cursor C]
  fav add <공고ID> [--memo 메모]
  fav rm <즐겨찾기ID> [--yes]

키워드 알림 (구글 로그인 필요)
  alerts ls
  alerts add --name 이름 -c <startup|bid|support|rnd|all> --include "키워드1,키워드2"
             [--exclude "키워드"] [--region 서울]...
  alerts rm <알림ID> [--yes]
  alerts test <알림ID> [--days 7]             최근 N일 매칭 미리보기(메일 발송 없음)
  alerts matches [--since 2026-09-30] [--limit N] [--cursor C]
  alerts settings [--on|--off] [--time 08:00] [--email 주소]

에이전트
  mcp                 MCP 서버(stdio)를 실행합니다
  skills install      npx skills add ${SITE} 로 Agent Skill 을 설치합니다

공통 옵션
  --json | --jsonl | --csv   출력 형식(기본: 터미널이면 표, 파이프면 JSON)
  --api-key <키>             이 실행에만 쓸 키. 우선순위: --api-key > BIZBELL_API_KEY > 저장된 키
  -h, --help | -v, --version

환경 변수: BIZBELL_API_KEY, BIZBELL_API_BASE(기본 https://bizbell.site/api/v1)
종료 코드: 0 성공 · 1 오류 · 2 사용법 · 3 인증 필요 · 4 한도 초과 · 5 없음`

/** @typedef {import('node:util').ParseArgsConfig['options']} Options */
/** @typedef {{values: Record<string, any>, positionals: string[], key?: string, keySource?: string, format: import('./format.js').Format}} Ctx */

const S = /** @type {const} */ ({ type: 'string' })
const B = /** @type {const} */ ({ type: 'boolean' })
const M = /** @type {const} */ ({ type: 'string', multiple: true })
const GLOBAL = { 'api-key': S, json: B, jsonl: B, csv: B, help: { ...B, short: 'h' } }
const PAGE = { limit: S, cursor: S }

/** 쉼표로 이어 쓴 값과 반복 옵션을 모두 받는다. @param {string[] | string | undefined} v */
const list = (v) => (v === undefined ? undefined : [v].flat().flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean))

/** 옵션(kebab-case)을 API 쿼리(snake_case)로. 전역 옵션은 뺀다. @param {Record<string, any>} values */
function toQuery(values, rename = /** @type {Record<string, string>} */ ({})) {
  /** @type {Record<string, unknown>} */
  const q = {}
  for (const [k, v] of Object.entries(values)) {
    if (k in GLOBAL) continue
    q[rename[k] ?? k.replaceAll('-', '_')] = Array.isArray(v) ? list(v) : v
  }
  return q
}

/** @param {string[]} positionals @param {string} what */
function arg(positionals, what) {
  if (!positionals[0]) throw usageError(`${what} 를 지정하세요.`)
  return positionals[0]
}

/** 삭제 전 확인. 터미널이 아니면(에이전트) --yes 가 있어야 한다. @param {Ctx} ctx @param {string} question */
async function confirm(ctx, question) {
  if (ctx.values.yes) return
  if (!process.stdin.isTTY) {
    throw usageError('되돌릴 수 없는 작업이라 확인이 필요합니다.', '사용자에게 확인받은 뒤 --yes 를 붙여 다시 실행하세요.')
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = await rl.question(`${question} [y/N] `)
  rl.close()
  if (!/^y(es)?$/i.test(answer.trim())) throw new BizbellError(1, { code: 'cancelled', message: '취소했습니다.' })
}

/** @param {string} url */
function openUrl(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}

/** 디바이스 코드 로그인: 코드 발급 → 사용자가 브라우저에서 승인 → 토큰 폴링. @param {Ctx} ctx */
async function deviceLogin(ctx) {
  const start = await request('POST', '/device', {
    base: CLI_BASE,
    auth: false,
    body: { client_name: `bizbell-cli on ${hostname()}` },
  })
  const url =
    start.verification_uri_complete ??
    `${start.verification_uri ?? `${SITE}/cli/activate`}?code=${encodeURIComponent(start.user_code)}`
  process.stderr.write(
    `\n브라우저에서 아래 주소를 열고 구글 계정으로 로그인한 뒤 코드가 같은지 확인해 승인해 주세요.\n\n  ${url}\n  코드: ${start.user_code}\n\n승인을 기다리는 중입니다…\n`,
  )
  if (!ctx.values['no-browser'] && process.stdin.isTTY) openUrl(url)

  let interval = (start.interval ?? 5) * 1000
  const until = Date.now() + (start.expires_in ?? 600) * 1000
  while (Date.now() < until) {
    await sleep(interval)
    try {
      const token = await request('POST', '/device/token', {
        base: CLI_BASE,
        auth: false,
        body: { device_code: start.device_code },
      })
      if (!token.api_key) throw new BizbellError(1, { code: 'invalid_response', message: '서버가 API 키를 돌려주지 않았습니다.' })
      return { api_key: token.api_key, email: token.email }
    } catch (e) {
      const code = /** @type {any} */ (e).error?.code
      if (code === 'authorization_pending') continue
      if (code === 'slow_down') {
        interval += 5000
        continue
      }
      throw e // expired_token, access_denied 등
    }
  }
  throw new BizbellError(3, { code: 'expired_token', message: '로그인 코드가 만료됐습니다.', hint: 'bizbell login 을 다시 실행하세요.' })
}

/** @typedef {{options?: Options, raw?: boolean, columns?: import('./format.js').Column[], run: (ctx: Ctx) => Promise<unknown> | unknown}} Command */

/** @type {Record<string, Command>} */
const COMMANDS = {
  login: {
    options: { 'no-browser': B },
    async run(ctx) {
      const flag = ctx.values['api-key']
      let apiKey, email
      if (flag) {
        apiKey = flag === '-' ? readFileSync(0, 'utf8').trim() : flag
        email = (await api.me(apiKey))?.data?.email // 저장 전에 키가 유효한지 확인한다
      } else {
        ;({ api_key: apiKey, email } = await deviceLogin(ctx))
      }
      const file = saveKey(apiKey)
      if (process.env.BIZBELL_API_KEY) process.stderr.write('참고: BIZBELL_API_KEY 가 설정돼 있어 저장한 키보다 우선합니다.\n')
      return { authenticated: true, email, saved_to: file }
    },
  },
  logout: {
    run() {
      const removed = deleteKey()
      process.stderr.write(`키 자체는 폐기되지 않았습니다. 폐기하려면 ${SITE}/settings/api 에서 지우세요.\n`)
      return { logged_out: true, removed: removed ? credentialsPath() : null }
    },
  },
  whoami: {
    async run({ key, keySource }) {
      try {
        const me = await api.me(key)
        return { authenticated: true, key_source: keySource, ...(me?.data ?? me) }
      } catch (e) {
        if (!(e instanceof BizbellError) || e.exit !== 3) throw e
        process.exitCode = 3
        return { authenticated: false, error: e.error }
      }
    },
  },
  usage: {
    async run({ key }) {
      const me = (await api.me(key))?.data ?? {}
      return { plan: me.plan, quota: me.quota, rate_limit: me.rate_limit }
    },
  },
  search: {
    options: {
      category: { ...M, short: 'c' },
      source: M,
      region: M,
      org: S,
      status: S,
      'deadline-within': S,
      'deadline-after': S,
      'always-open': B,
      'budget-min': S,
      'budget-max': S,
      'published-since': S,
      'updated-since': S,
      sort: S,
      fields: S,
      ...PAGE,
    },
    columns: NOTICE_COLUMNS,
    run: ({ key, values, positionals }) =>
      api.searchNotices(key, { q: positionals.join(' ') || undefined, ...toQuery(values, { org: 'organization' }) }),
  },
  show: {
    options: { open: B },
    async run({ key, values, positionals }) {
      const res = await api.getNotice(key, arg(positionals, '공고 ID'))
      const notice = res?.data ?? res
      if (values.open && (notice.bizbell_url || notice.source_url)) openUrl(notice.bizbell_url || notice.source_url)
      return res
    },
  },
  'fav ls': {
    options: { status: S, ...PAGE },
    columns: FAVORITE_COLUMNS,
    run: ({ key, values }) => api.listFavorites(key, toQuery(values)),
  },
  'fav add': {
    options: { memo: S },
    run: ({ key, values, positionals }) =>
      api.addFavorite(key, { notice_id: arg(positionals, '공고 ID'), memo: values.memo }),
  },
  'fav rm': {
    options: { yes: { ...B, short: 'y' } },
    async run(ctx) {
      const id = arg(ctx.positionals, '즐겨찾기 ID')
      await confirm(ctx, `즐겨찾기 ${id} 를 삭제할까요?`)
      await api.removeFavorite(ctx.key, id)
      return { deleted: true, id }
    },
  },
  'alerts ls': {
    columns: ALERT_COLUMNS,
    run: ({ key }) => api.listAlerts(key),
  },
  'alerts add': {
    options: { name: S, category: { ...S, short: 'c' }, include: M, exclude: M, region: M },
    run: ({ key, values: v }) =>
      api.createAlert(key, {
        name: v.name,
        category: v.category,
        include: list(v.include),
        exclude: list(v.exclude),
        regions: list(v.region),
      }),
  },
  'alerts rm': {
    options: { yes: { ...B, short: 'y' } },
    async run(ctx) {
      const id = arg(ctx.positionals, '알림 ID')
      await confirm(ctx, `알림 ${id} 를 삭제할까요?`)
      await api.removeAlert(ctx.key, id)
      return { deleted: true, id }
    },
  },
  'alerts test': {
    options: { days: S },
    columns: NOTICE_COLUMNS,
    run: ({ key, values, positionals }) => api.testAlert(key, arg(positionals, '알림 ID'), values.days),
  },
  'alerts matches': {
    options: { since: S, ...PAGE },
    columns: NOTICE_COLUMNS,
    run: ({ key, values }) => api.alertMatches(key, toQuery(values)),
  },
  'alerts settings': {
    options: { on: B, off: B, time: S, email: S },
    run({ key, values: v }) {
      if (v.on && v.off) throw usageError('--on 과 --off 는 함께 쓸 수 없습니다.')
      const body = { enabled: v.on ? true : v.off ? false : undefined, time: v.time, email: v.email }
      return api.alertSettings(key, Object.values(body).some((x) => x !== undefined) ? body : undefined)
    },
  },
  mcp: {
    run: ({ key }) => serveMcp(key),
  },
  'skills install': {
    raw: true, // -g, -a claude-code 같은 skills CLI 옵션을 그대로 넘긴다
    run: ({ positionals }) =>
      new Promise((resolve) => {
        const args = ['-y', 'skills', 'add', SITE, ...positionals]
        process.stderr.write(`> npx ${args.join(' ')}\n`)
        spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' })
          .on('error', () => {
            process.stderr.write(`npx 를 실행하지 못했습니다. 직접 실행하세요: npx skills add ${SITE}\n`)
            process.exitCode = 1
            resolve(undefined)
          })
          .on('exit', (code) => {
            process.exitCode = code ?? 1
            resolve(undefined)
          })
      }),
  },
}

/** @param {string[]} argv @returns {Promise<number | undefined>} */
async function main(argv) {
  const format = pickFormat(argv)
  try {
    const [cmd, ...rest] = argv
    if (cmd === '-v' || cmd === '--version') return void process.stdout.write(`${VERSION}\n`)
    if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
      process.stdout.write(`${HELP}\n`)
      return cmd ? 0 : 2
    }
    const group = ['fav', 'alerts', 'skills'].includes(cmd)
    const name = group ? `${cmd} ${rest[0] ?? ''}`.trim() : cmd
    const command = COMMANDS[name]
    if (!command) throw usageError(`알 수 없는 명령입니다: ${name}`)
    const args = group ? rest.slice(1) : rest

    const { values, positionals } = command.raw
      ? { values: {}, positionals: args }
      : parseArgs({ args, options: { ...GLOBAL, ...command.options }, allowPositionals: true, strict: true })
    if (values.help) return void process.stdout.write(`${HELP}\n`)

    const { key, source } = resolveKey(/** @type {string | undefined} */ (values['api-key']))
    const result = await command.run({ values, positionals, key, keySource: source, format })
    if (result !== undefined) print(format, result, command.columns)
    // 공고 API 공지(약관 제13조의2제1항나목·제25조)는 표·JSON 출력과 섞이지 않게 stderr 로 알린다.
    for (const a of /** @type {any} */ (result)?.meta?.announcements ?? []) {
      process.stderr.write(`공지: ${a.text}${a.effective ? ` (시행 ${a.effective})` : ''}${a.url ? ` ${a.url}` : ''}\n`)
    }
  } catch (e) {
    const parseError = /** @type {any} */ (e).code?.startsWith?.('ERR_PARSE_ARGS')
    const err =
      e instanceof BizbellError
        ? e
        : parseError
          ? usageError(`옵션을 해석하지 못했습니다: ${/** @type {Error} */ (e).message}`)
          : new BizbellError(1, { code: 'internal', message: String(/** @type {Error} */ (e)?.message ?? e) })
    if (format !== 'table') process.stdout.write(`${JSON.stringify({ error: err.error }, null, 2)}\n`)
    process.stderr.write(`오류: ${err.error.message}${err.error.hint ? `\n힌트: ${err.error.hint}` : ''}\n`)
    return err.exit
  }
}

process.exitCode = (await main(process.argv.slice(2))) ?? process.exitCode
