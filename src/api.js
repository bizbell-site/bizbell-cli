// @ts-check
// BizBell 공고 API 클라이언트. 런타임 의존성 없이 전역 fetch 만 쓴다(Node 18+).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
export const API_BASE = (process.env.BIZBELL_API_BASE || 'https://bizbell.site/api/v1').replace(/\/+$/, '')
/** 디바이스 로그인 경로(/api/cli/*). API_BASE 가 …/api/v1 이면 …/api/cli 가 된다. */
export const CLI_BASE = new URL('../cli', `${API_BASE}/`).href
export const SITE = new URL(API_BASE).origin

/** 종료 코드: 0 성공 · 1 오류 · 2 사용법 · 3 인증 필요 · 4 한도 초과 · 5 없음 */
export class BizbellError extends Error {
  /** @param {number} exit @param {{code: string, message: string, hint?: string, [k: string]: unknown}} error */
  constructor(exit, error) {
    super(error.message)
    this.exit = exit
    this.error = error
  }
}

/** @param {number} status */
export const exitCodeFor = (status) =>
  status === 401 || status === 403 ? 3 : status === 429 ? 4 : status === 404 ? 5 : status === 400 || status === 422 ? 2 : 1

export const usageError = (/** @type {string} */ message, hint = 'bizbell --help') =>
  new BizbellError(2, { code: 'usage', message, hint })

// ── 자격증명: --api-key > BIZBELL_API_KEY > ~/.config/bizbell/credentials.json(0600) ──

export function credentialsPath() {
  const root =
    process.platform === 'win32'
      ? process.env.APPDATA || homedir()
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(root, 'bizbell', 'credentials.json')
}

/** @param {string} [flagKey] @returns {{key?: string, source?: 'flag' | 'env' | 'file'}} */
export function resolveKey(flagKey) {
  if (flagKey) return { key: flagKey, source: 'flag' }
  if (process.env.BIZBELL_API_KEY) return { key: process.env.BIZBELL_API_KEY, source: 'env' }
  try {
    const key = JSON.parse(readFileSync(credentialsPath(), 'utf8')).api_key
    return key ? { key, source: 'file' } : {}
  } catch {
    return {}
  }
}

/** @param {string} apiKey */
export function saveKey(apiKey) {
  const file = credentialsPath()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify({ api_key: apiKey }, null, 2)}\n`, { mode: 0o600 })
  chmodSync(file, 0o600) // ponytail: writeFileSync 의 mode 는 새 파일에만 적용된다
  return file
}

export function deleteKey() {
  const file = credentialsPath()
  const existed = existsSync(file)
  rmSync(file, { force: true })
  return existed
}

// ── HTTP ──

/**
 * @param {string} method
 * @param {string} path
 * @param {{key?: string, query?: Record<string, unknown>, body?: unknown, base?: string, auth?: boolean}} [opts]
 * @returns {Promise<any>}
 */
export async function request(method, path, { key, query, body, base = API_BASE, auth = true } = {}) {
  if (auth && !key) {
    throw new BizbellError(3, {
      code: 'unauthorized',
      message: '로그인이 필요합니다.',
      hint: 'bizbell login 을 실행하거나 BIZBELL_API_KEY 환경 변수를 설정하세요.',
    })
  }
  const url = new URL(base + path)
  for (const [k, v] of Object.entries(query ?? {})) {
    const value = Array.isArray(v) ? v.join(',') : v
    if (value !== undefined && value !== null && value !== '' && value !== false) url.searchParams.set(k, String(value))
  }
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json', 'user-agent': `bizbell-cli/${VERSION} node/${process.versions.node}` }
  if (key) headers.authorization = `Bearer ${key}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    const cause = /** @type {any} */ (e).cause?.message ?? /** @type {Error} */ (e).message
    throw new BizbellError(1, { code: 'network_error', message: `${url.host} 에 연결하지 못했습니다: ${cause}` })
  }

  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const err = data?.error
    const error =
      err && typeof err === 'object'
        ? { ...err }
        : { code: typeof err === 'string' ? err : `http_${res.status}`, message: `HTTP ${res.status} 응답을 받았습니다.` }
    const retryAfter = res.headers.get('retry-after')
    if (retryAfter && error.retry_after === undefined) error.retry_after = Number(retryAfter)
    throw new BizbellError(exitCodeFor(res.status), error)
  }
  if (data === undefined) {
    throw new BizbellError(1, { code: 'invalid_response', message: `서버 응답이 JSON 이 아닙니다(HTTP ${res.status}).` })
  }
  return data
}

// ── 엔드포인트 (PIVOT_DESIGN §5.2). CLI 와 MCP 가 같이 쓴다. ──

const id = (/** @type {unknown} */ v) => encodeURIComponent(String(v ?? ''))

export const api = {
  /** @param {string | undefined} key */
  me: (key) => request('GET', '/me', { key }),
  /** @param {string | undefined} key @param {Record<string, unknown>} query */
  searchNotices: (key, query) => request('GET', '/notices', { key, query }),
  /** @param {string | undefined} key @param {string} noticeId */
  getNotice: (key, noticeId) => request('GET', `/notices/${id(noticeId)}`, { key }),
  /** @param {string | undefined} key @param {Record<string, unknown>} query */
  listFavorites: (key, query) => request('GET', '/favorites', { key, query }),
  /** @param {string | undefined} key @param {{notice_id: string, memo?: string}} body */
  addFavorite: (key, body) => request('POST', '/favorites', { key, body }),
  /** @param {string | undefined} key @param {string} favoriteId */
  removeFavorite: (key, favoriteId) => request('DELETE', `/favorites/${id(favoriteId)}`, { key }),
  /** @param {string | undefined} key */
  listAlerts: (key) => request('GET', '/alerts', { key }),
  /** @param {string | undefined} key @param {Record<string, unknown>} body name, category, include[], exclude[], regions[] */
  createAlert: (key, body) => request('POST', '/alerts', { key, body }),
  /** @param {string | undefined} key @param {string} alertId */
  removeAlert: (key, alertId) => request('DELETE', `/alerts/${id(alertId)}`, { key }),
  /** @param {string | undefined} key @param {string} alertId @param {unknown} [days] */
  testAlert: (key, alertId, days) => request('POST', `/alerts/${id(alertId)}/test`, { key, query: { days } }),
  /** @param {string | undefined} key @param {Record<string, unknown>} query since, limit, cursor */
  alertMatches: (key, query) => request('GET', '/alerts/matches', { key, query }),
  /** @param {string | undefined} key @param {Record<string, unknown>} [body] enabled, time, email. 없으면 조회 */
  alertSettings: (key, body) =>
    body ? request('PATCH', '/alerts/settings', { key, body }) : request('GET', '/alerts/settings', { key }),
}
