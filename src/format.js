// @ts-check
// 출력 형식: 터미널이면 사람이 읽는 표, 파이프면 JSON. --json/--jsonl/--csv 로 강제한다.

/** @typedef {'table' | 'json' | 'jsonl' | 'csv'} Format */
/** @typedef {[string, (row: any) => unknown, number?]} Column 머리글, 값, 최대 폭 */

/** @param {string[]} argv @returns {Format} */
export function pickFormat(argv) {
  for (const f of /** @type {const} */ (['json', 'jsonl', 'csv'])) if (argv.includes(`--${f}`)) return f
  return process.stdout.isTTY ? 'table' : 'json'
}

// 한글·CJK·전각 문자는 터미널에서 2칸을 차지한다.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u
/** @param {string} s */
export const width = (s) => [...s].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0)

/** @param {string} s @param {number} max */
function truncate(s, max) {
  if (width(s) <= max) return s
  let out = ''
  for (const ch of s) {
    if (width(out + ch) > max - 1) break
    out += ch
  }
  return `${out}…`
}

/** @param {unknown} v */
const text = (v) =>
  v === null || v === undefined || v === ''
    ? '-'
    : Array.isArray(v)
      ? v.join(', ')
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v).replace(/\s+/g, ' ')

/** @param {any[]} rows @param {Column[]} columns */
export function table(rows, columns) {
  const cells = rows.map((r) => columns.map(([, get, max]) => truncate(text(get(r)), max ?? 60)))
  const head = columns.map(([h]) => h)
  const widths = head.map((h, i) => Math.max(width(h), ...cells.map((c) => width(c[i]))))
  return [head, ...cells]
    .map((line) => line.map((c, i) => c + ' '.repeat(widths[i] - width(c))).join('  ').trimEnd())
    .join('\n')
}

/** 엑셀에서 한글이 깨지지 않도록 BOM 을 붙인다. @param {any[]} rows */
export function csv(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))]
  /** @param {unknown} v */
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  return `﻿${[cols.map(cell), ...rows.map((r) => cols.map((c) => cell(r?.[c])))].map((l) => l.join(',')).join('\r\n')}`
}

/** @param {Record<string, unknown>} obj */
const kv = (obj) =>
  Object.entries(obj ?? {})
    .map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? JSON.stringify(v) : (v ?? '-')}`)
    .join('\n')

/**
 * @param {Format} format
 * @param {any} body API 응답 그대로({data, next_cursor, total, meta}) 또는 일반 객체
 * @param {Column[]} [columns] 목록일 때 표 열
 */
export function print(format, body, columns) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : null
  /** @param {string} s */
  const out = (s) => process.stdout.write(`${s}\n`)
  if (format === 'json') return out(JSON.stringify(body, null, 2))
  if (format === 'jsonl') return (rows ?? [body]).forEach((r) => out(JSON.stringify(r)))
  if (format === 'csv') return out(csv(rows ?? [body]))
  if (!rows) return out(kv(body?.data && typeof body.data === 'object' ? body.data : body))
  out(rows.length ? table(rows, columns ?? Object.keys(rows[0]).map((k) => [k, (r) => r[k]])) : '결과가 없습니다.')
  const foot = [body.total !== undefined && `약 ${body.total}건`, body.next_cursor && `다음 페이지: --cursor ${body.next_cursor}`]
  if (foot.some(Boolean)) out(`\n${foot.filter(Boolean).join(' · ')}`)
}

// ── 목록 열 ──

/** UTC ISO 시각을 KST "YYYY-MM-DD HH:mm" 로. @param {string} iso */
export const kst = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16)

/** @param {any} n */
export const deadline = (n) =>
  n?.deadline_date ?? (n?.deadline_at ? kst(n.deadline_at) : n?.always_open ? '상시' : null)

/** @type {Column[]} */
export const NOTICE_COLUMNS = [
  ['ID', (n) => n.id],
  ['분야', (n) => n.category],
  ['제목', (n) => n.title, 44],
  ['기관', (n) => n.organization, 18],
  ['마감', deadline],
]

/** @type {Column[]} */
export const FAVORITE_COLUMNS = [
  ['ID', (f) => f.id],
  ['공고 ID', (f) => f.notice_id],
  ['제목', (f) => f.notice?.title ?? f.title, 40],
  ['마감', (f) => deadline(f.notice)],
  ['메모', (f) => f.memo, 20],
]

/** @type {Column[]} */
export const ALERT_COLUMNS = [
  ['ID', (a) => a.id],
  ['이름', (a) => a.name, 20],
  ['분야', (a) => a.category],
  ['포함', (a) => a.include, 24],
  ['제외', (a) => a.exclude, 16],
  ['지역', (a) => a.regions, 16],
]
