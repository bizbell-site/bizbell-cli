// 테스트용 가짜 BizBell API(node:http). PIVOT_DESIGN §5 계약을 흉내 낸다.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const GOOD_KEY = 'bb_test_goodkey_0123456789'
export const CLI = new URL('../src/cli.js', import.meta.url).pathname

export const NOTICES = [
  {
    id: 'nara:R26BK01752060',
    category: 'bid',
    source: 'nara',
    title: '자원관리센터 내 과다 적치폐기물 위탁처리 용역',
    organization: '서울특별시 강남구',
    regions: ['서울'],
    status: 'open',
    deadline_at: '2026-10-09T01:00:00Z',
    deadline_date: null,
    always_open: false,
    budget_krw: 123000000,
    source_url: 'https://www.g2b.go.kr/notice/R26BK01752060',
    bizbell_url: 'https://bizbell.site/biz/domestic/nara/R26BK01752060_000',
    attribution: { text: '출처: 조달청 나라장터(공공데이터포털)', license: 'data.go.kr 이용허락 제한없음' },
  },
  {
    id: 'kstartup:179363',
    category: 'startup',
    source: 'kstartup',
    title: '2026 예비창업패키지 "AI, 딥테크" 분야 모집',
    organization: '창업진흥원',
    regions: ['전국'],
    status: 'open',
    deadline_at: null,
    deadline_date: null,
    always_open: true,
    budget_krw: null,
    source_url: 'https://www.k-startup.go.kr/notice/179363',
    bizbell_url: 'https://bizbell.site/biz/startup/179363',
    attribution: { text: '출처: 창업진흥원 K-Startup(공공데이터포털)', license: 'KOGL 1유형' },
  },
]

const err = (code, message, extra) => ({ error: { code, message, ...extra } })

/** 가짜 API 서버를 띄운다. calls 에 받은 요청을 쌓는다. */
export async function startFakeApi() {
  const calls = []
  const favorites = []
  const alerts = []
  let settings = { enabled: true, time: '09:00', email: 'user@example.com' }
  let tokenPolls = 0

  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const url = new URL(req.url, 'http://fake')
    const body = raw ? JSON.parse(raw) : undefined
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body })
    const send = (status, data) => {
      res.writeHead(status, data === undefined ? {} : { 'content-type': 'application/json' })
      res.end(data === undefined ? undefined : JSON.stringify(data))
    }

    const p = url.pathname
    if (req.method === 'POST' && p === '/api/cli/device') {
      return send(200, {
        device_code: 'dev_123',
        user_code: 'ABCD-1234',
        verification_uri: `http://${req.headers.host}/cli/activate`,
        expires_in: 5,
        interval: 0.02,
      })
    }
    if (req.method === 'POST' && p === '/api/cli/device/token') {
      if (body?.device_code !== 'dev_123') return send(400, err('invalid_grant', '알 수 없는 코드'))
      return ++tokenPolls < 3
        ? send(400, err('authorization_pending', '승인 대기 중'))
        : send(200, { api_key: GOOD_KEY, email: 'user@example.com' })
    }
    if (!p.startsWith('/api/v1/')) return send(404, err('not_found', '없는 경로'))
    if (req.headers.authorization !== `Bearer ${GOOD_KEY}`) {
      return send(401, err('unauthorized', 'API 키가 올바르지 않습니다.', { hint: 'npx bizbell login' }))
    }

    const route = `${req.method} ${p.slice('/api/v1'.length)}`
    const [, resource, id, action] =p.slice('/api/v1'.length).split('/').map(decodeURIComponent)
    const meta = { as_of: '2026-10-01T02:00:05Z', request_id: 'req_test' }

    if (route === 'GET /me') {
      return send(200, {
        data: {
          email: 'user@example.com',
          plan: 'free',
          quota: { used: 12, limit: 3000, reset_at: '2026-11-01T00:00:00+09:00' },
          rate_limit: { per_minute: 30 },
          key: { prefix: 'bb_test_goodkey', scopes: ['notices:read', 'favorites:write', 'alerts:write'] },
        },
      })
    }
    if (route === 'GET /notices') {
      if (url.searchParams.get('q') === 'quota') {
        res.setHeader('retry-after', '3600')
        return send(429, err('quota_exceeded', '이번 달 무료 호출을 모두 썼습니다.', { hint: 'bizbell usage', reset_at: '2026-11-01T00:00:00+09:00' }))
      }
      if (url.searchParams.get('limit') === '999') return send(422, err('invalid_parameter', 'limit 은 1~50 입니다.'))
      return send(200, { data: NOTICES, next_cursor: 'cur_2', total: 2, meta })
    }
    if (req.method === 'GET' && resource === 'notices' && id) {
      const notice = NOTICES.find((n) => n.id === id)
      return notice ? send(200, { data: notice, meta }) : send(404, err('not_found', '공고를 찾지 못했습니다.'))
    }
    if (route === 'GET /favorites') return send(200, { data: favorites, next_cursor: null, meta })
    if (route === 'POST /favorites') {
      const fav = { id: `fav_${favorites.length + 1}`, notice_id: body.notice_id, memo: body.memo ?? null, notice: NOTICES.find((n) => n.id === body.notice_id) ?? null }
      favorites.push(fav)
      return send(201, { data: fav })
    }
    if (req.method === 'DELETE' && resource === 'favorites') {
      const i = favorites.findIndex((f) => f.id === id)
      if (i < 0) return send(404, err('not_found', '즐겨찾기를 찾지 못했습니다.'))
      favorites.splice(i, 1)
      return send(204)
    }
    if (route === 'GET /alerts') return send(200, { data: alerts, meta })
    if (route === 'POST /alerts') {
      const alert = { id: `alert_${alerts.length + 1}`, ...body }
      alerts.push(alert)
      return send(201, { data: alert })
    }
    if (route === 'GET /alerts/matches') return send(200, { data: [NOTICES[1]], next_cursor: null, meta })
    if (route === 'GET /alerts/settings') return send(200, { data: settings })
    if (route === 'PATCH /alerts/settings') {
      settings = { ...settings, ...body }
      return send(200, { data: settings })
    }
    if (req.method === 'POST' && resource === 'alerts' && action === 'test') {
      return alerts.some((a) => a.id === id) ? send(200, { data: [NOTICES[0]], meta }) : send(404, err('not_found', '알림을 찾지 못했습니다.'))
    }
    if (req.method === 'DELETE' && resource === 'alerts') {
      const i = alerts.findIndex((a) => a.id === id)
      if (i < 0) return send(404, err('not_found', '알림을 찾지 못했습니다.'))
      alerts.splice(i, 1)
      return send(204)
    }
    return send(404, err('not_found', `없는 경로: ${route}`))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}/api/v1`,
    calls,
    last: () => calls.at(-1),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** 격리된 설정 디렉토리에서 CLI 를 실행한다(사용자 환경의 BIZBELL_API_KEY·자격증명 파일을 읽지 않는다). */
export function makeRunner(base) {
  const home = mkdtempSync(join(tmpdir(), 'bizbell-cli-test-'))
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), BIZBELL_API_BASE: base }
  const run = (args, { env: extra = {}, input } = {}) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args], { env: { ...env, ...extra } })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('close', (code) => resolve({ code, stdout, stderr, json: () => JSON.parse(stdout) }))
      child.stdin.end(input)
    })
  return { run, home, credentials: join(home, '.config', 'bizbell', 'credentials.json') }
}
