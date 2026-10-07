import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { csv, deadline, NOTICE_COLUMNS, table, width } from '../src/format.js'
import { GOOD_KEY, makeRunner, NOTICES, startFakeApi } from './fake-api.js'

let fake
let cli
before(async () => {
  fake = await startFakeApi()
  cli = makeRunner(fake.base)
})
after(() => fake.close())
const withKey = { env: { BIZBELL_API_KEY: GOOD_KEY } }

describe('출력 포맷', () => {
  test('한글은 2칸으로 계산해 열을 맞춘다', () => {
    assert.equal(width('abc'), 3)
    assert.equal(width('공고'), 4)
    const lines = table(NOTICES, NOTICE_COLUMNS).split('\n')
    assert.equal(lines.length, 3)
    const col = (line) => width(line.slice(0, line.search(/ (bid|startup) /)))
    assert.equal(col(lines[1]), col(lines[2]), '분야 열의 시작 위치가 같아야 한다')
    assert.match(lines[2], /상시$/)
  })

  test('긴 제목은 최대 폭에서 말줄임한다', () => {
    const out = table([{ t: '가'.repeat(30) }], [['제목', (r) => r.t, 10]])
    assert.equal(out.split('\n')[1], `${'가'.repeat(4)}…`)
  })

  test('CSV 는 BOM·따옴표·쉼표를 처리한다', () => {
    const out = csv([{ id: 'a', title: '"AI, 딥테크"', regions: ['서울'] }])
    assert.ok(out.startsWith('﻿id,title,regions\r\n'))
    assert.ok(out.includes('"""AI, 딥테크"""'))
    assert.ok(out.includes('"[""서울""]"'))
  })

  test('마감은 KST 로, 없으면 상시로 표시한다', () => {
    assert.equal(deadline(NOTICES[0]), '2026-10-09 10:00')
    assert.equal(deadline(NOTICES[1]), '상시')
    assert.equal(deadline({ deadline_date: '2026-10-31' }), '2026-10-31')
  })
})

describe('인자 파싱과 종료 코드', () => {
  test('--help 는 0, 명령 없음은 2', async () => {
    const help = await cli.run(['--help'])
    assert.equal(help.code, 0)
    assert.match(help.stdout, /사용법: bizbell/)
    assert.equal((await cli.run([])).code, 2)
    assert.match((await cli.run(['--version'])).stdout, /^\d+\.\d+\.\d+\n$/)
  })

  test('알 수 없는 명령·옵션은 2 와 usage 오류', async () => {
    for (const args of [['nope'], ['fav'], ['search', '--nope'], ['show']]) {
      const r = await cli.run(args, withKey)
      assert.equal(r.code, 2, args.join(' '))
      assert.equal(r.json().error.code, 'usage')
    }
  })

  test('자격증명이 없으면 요청 없이 3', async () => {
    const before = fake.calls.length
    const r = await cli.run(['search', 'AI'])
    assert.equal(r.code, 3)
    assert.equal(r.json().error.code, 'unauthorized')
    assert.match(r.stderr, /bizbell login/)
    assert.equal(fake.calls.length, before)
  })

  test('HTTP 상태를 종료 코드로 옮긴다: 401→3, 404→5, 429→4, 422→2', async () => {
    const bad = await cli.run(['search', 'AI', '--api-key', 'bb_live_wrong'])
    assert.equal(bad.code, 3)
    assert.equal(bad.json().error.hint, 'npx bizbell login')

    const missing = await cli.run(['show', 'nara:nope'], withKey)
    assert.equal(missing.code, 5)

    const quota = await cli.run(['search', 'quota'], withKey)
    assert.equal(quota.code, 4)
    assert.equal(quota.json().error.code, 'quota_exceeded')
    assert.equal(quota.json().error.retry_after, 3600)
    assert.match(quota.stderr, /bizbell usage/)

    assert.equal((await cli.run(['search', '--limit', '999'], withKey)).code, 2)
  })

  test('서버가 꺼져 있으면 1', async () => {
    const offline = makeRunner('http://127.0.0.1:9/api/v1')
    const r = await offline.run(['search', 'AI'], withKey)
    assert.equal(r.code, 1)
    assert.equal(r.json().error.code, 'network_error')
  })
})

describe('자격증명 우선순위: --api-key > BIZBELL_API_KEY > 파일', () => {
  test('세 곳에 모두 있으면 플래그, 그다음 env, 그다음 파일을 쓴다', async () => {
    const r = makeRunner(fake.base)
    mkdirSync(dirname(r.credentials), { recursive: true })
    writeFileSync(r.credentials, JSON.stringify({ api_key: 'bb_from_file' }))
    const seen = async (args, env) => {
      await r.run(['whoami', ...args], { env })
      return fake.last().auth
    }
    assert.equal(await seen(['--api-key', 'bb_from_flag'], { BIZBELL_API_KEY: 'bb_from_env' }), 'Bearer bb_from_flag')
    assert.equal(await seen([], { BIZBELL_API_KEY: 'bb_from_env' }), 'Bearer bb_from_env')
    assert.equal(await seen([], {}), 'Bearer bb_from_file')
  })
})

describe('공고 검색·상세 (가짜 API end-to-end)', () => {
  test('응답 meta.announcements 공지는 stdout 을 건드리지 않고 stderr 로 알린다', async () => {
    const r = await cli.run(['search', 'announce'], withKey)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.json().data.length, 2)
    assert.match(r.stderr, /공지: v0 필드 종료 예정 \(시행 2027-01-01\) https:\/\/bizbell\.site\/docs\/api#announcements/)
  })

  test('search 는 옵션을 API 쿼리로 옮기고 파이프면 JSON 을 낸다', async () => {
    const r = await cli.run(
      ['search', 'AI', '바우처', '-c', 'bid', '-c', 'startup,rnd', '--region', '서울', '--org', '중기부', '--deadline-within', '7', '--always-open', '--limit', '5'],
      withKey,
    )
    assert.equal(r.code, 0, r.stderr)
    const { path, query, auth } = fake.last()
    assert.equal(path, '/api/v1/notices')
    assert.equal(auth, `Bearer ${GOOD_KEY}`)
    assert.deepEqual(query, {
      q: 'AI 바우처',
      category: 'bid,startup,rnd',
      region: '서울',
      organization: '중기부',
      deadline_within: '7',
      always_open: 'true',
      limit: '5',
    })
    const body = r.json()
    assert.equal(body.data.length, 2)
    assert.equal(body.next_cursor, 'cur_2')
  })

  test('--jsonl 은 한 줄에 공고 하나, --csv 는 머리글 + 행', async () => {
    const jsonl = await cli.run(['search', '--jsonl'], withKey)
    const lines = jsonl.stdout.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.equal(JSON.parse(lines[0]).id, NOTICES[0].id)

    const out = await cli.run(['search', '--csv'], withKey)
    const rows = out.stdout.trimEnd().split('\r\n')
    assert.equal(rows.length, 3)
    assert.ok(rows[0].startsWith('﻿id,category,source,title'))
  })

  test('show 는 공고 ID 를 경로에 인코딩해 조회한다', async () => {
    const r = await cli.run(['show', 'nara:R26BK01752060', '--json'], withKey)
    assert.equal(r.code, 0, r.stderr)
    assert.equal(fake.last().path, '/api/v1/notices/nara%3AR26BK01752060')
    assert.equal(r.json().data.attribution.text, '출처: 조달청 나라장터(공공데이터포털)')
  })

  test('whoami·usage', async () => {
    const who = await cli.run(['whoami'], withKey)
    assert.equal(who.code, 0)
    assert.deepEqual([who.json().authenticated, who.json().email, who.json().key_source], [true, 'user@example.com', 'env'])
    const usage = await cli.run(['usage'], withKey)
    assert.deepEqual(usage.json().quota, { used: 12, limit: 3000, reset_at: '2026-11-01T00:00:00+09:00' })
  })
})

describe('즐겨찾기·알림 (가짜 API end-to-end)', () => {
  test('fav add → ls → rm(확인 필요) → rm --yes', async () => {
    const added = await cli.run(['fav', 'add', 'nara:R26BK01752060', '--memo', '3월 검토'], withKey)
    assert.equal(added.code, 0, added.stderr)
    assert.deepEqual(fake.last().body, { notice_id: 'nara:R26BK01752060', memo: '3월 검토' })
    const favId = added.json().data.id

    const ls = await cli.run(['fav', 'ls', '--status', 'all'], withKey)
    assert.equal(fake.last().query.status, 'all')
    assert.equal(ls.json().data[0].notice.title, NOTICES[0].title)

    const calls = fake.calls.length
    const refused = await cli.run(['fav', 'rm', favId], withKey)
    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /--yes/)
    assert.equal(fake.calls.length, calls, '확인 없이 DELETE 를 보내면 안 된다')

    const removed = await cli.run(['fav', 'rm', favId, '--yes'], withKey)
    assert.equal(removed.code, 0, removed.stderr)
    assert.equal(fake.last().method, 'DELETE')
    assert.deepEqual(removed.json(), { deleted: true, id: favId })
    assert.equal((await cli.run(['fav', 'rm', favId, '-y'], withKey)).code, 5)
  })

  test('alerts add → ls → test → matches → settings → rm', async () => {
    const added = await cli.run(
      ['alerts', 'add', '--name', 'AI 바우처', '-c', 'support', '--include', 'AI,바우처', '--exclude', '교육', '--region', '서울', '--region', '경기'],
      withKey,
    )
    assert.equal(added.code, 0, added.stderr)
    assert.deepEqual(fake.last().body, {
      name: 'AI 바우처',
      category: 'support',
      include: ['AI', '바우처'],
      exclude: ['교육'],
      regions: ['서울', '경기'],
    })
    const alertId = added.json().data.id

    assert.equal((await cli.run(['alerts', 'ls'], withKey)).json().data.length, 1)

    const preview = await cli.run(['alerts', 'test', alertId, '--days', '7'], withKey)
    assert.equal(preview.code, 0, preview.stderr)
    assert.deepEqual([fake.last().method, fake.last().query.days], ['POST', '7'])

    const matches = await cli.run(['alerts', 'matches', '--since', '2026-09-30'], withKey)
    assert.equal(fake.last().query.since, '2026-09-30')
    assert.equal(matches.json().data[0].id, NOTICES[1].id)

    assert.equal((await cli.run(['alerts', 'settings'], withKey)).json().data.time, '09:00')
    assert.equal(fake.last().method, 'GET')
    const changed = await cli.run(['alerts', 'settings', '--off', '--time', '08:00'], withKey)
    assert.deepEqual([fake.last().method, fake.last().body], ['PATCH', { enabled: false, time: '08:00' }])
    assert.equal(changed.json().data.enabled, false)
    assert.equal((await cli.run(['alerts', 'settings', '--on', '--off'], withKey)).code, 2)

    assert.equal((await cli.run(['alerts', 'rm', alertId, '--yes'], withKey)).code, 0)
    assert.equal((await cli.run(['alerts', 'test', alertId], withKey)).code, 5)
  })
})

describe('로그인', () => {
  test('디바이스 코드: 안내 → 폴링 → 0600 파일 저장 → whoami → logout', async () => {
    const r = makeRunner(fake.base)
    const login = await r.run(['login'])
    assert.equal(login.code, 0, login.stderr)
    assert.match(login.stderr, /\/cli\/activate\?code=ABCD-1234/)
    assert.match(login.stderr, /코드: ABCD-1234/)
    assert.deepEqual(fake.calls.filter((c) => c.path === '/api/cli/device/token').at(-1).body, { device_code: 'dev_123' })
    assert.equal(login.json().authenticated, true)

    assert.equal(JSON.parse(readFileSync(r.credentials, 'utf8')).api_key, GOOD_KEY)
    if (process.platform !== 'win32') assert.equal(statSync(r.credentials).mode & 0o777, 0o600)

    const who = await r.run(['whoami'])
    assert.deepEqual([who.code, who.json().key_source], [0, 'file'])

    assert.equal((await r.run(['logout'])).code, 0)
    assert.equal(existsSync(r.credentials), false)
    const gone = await r.run(['whoami'])
    assert.equal(gone.code, 3)
    assert.equal(gone.json().authenticated, false)
  })

  test('--api-key 는 확인한 뒤에만 저장한다(- 는 stdin)', async () => {
    const r = makeRunner(fake.base)
    const bad = await r.run(['login', '--api-key', 'bb_live_wrong'])
    assert.equal(bad.code, 3)
    assert.equal(existsSync(r.credentials), false)

    const good = await r.run(['login', '--api-key', '-'], { input: `${GOOD_KEY}\n` })
    assert.equal(good.code, 0, good.stderr)
    assert.equal(good.json().email, 'user@example.com')
    assert.equal(JSON.parse(readFileSync(r.credentials, 'utf8')).api_key, GOOD_KEY)
  })
})
