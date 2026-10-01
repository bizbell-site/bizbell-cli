import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { CLI, GOOD_KEY, startFakeApi } from './fake-api.js'

let fake
before(async () => (fake = await startFakeApi()))
after(() => fake.close())

/** `bizbell mcp` 를 띄우고 stdin/stdout 파이프로 JSON-RPC 를 주고받는다. */
function startMcp(env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bizbell-mcp-test-'))
  const child = spawn(process.execPath, [CLI, 'mcp'], {
    env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, BIZBELL_API_BASE: fake.base, ...env },
  })
  const lines = []
  const waiters = new Map()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line) // stdout 에는 JSON-RPC 외의 출력이 없어야 한다
    lines.push(msg)
    waiters.get(msg.id)?.(msg)
  })
  let nextId = 1
  return {
    lines,
    write: (obj) => child.stdin.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`),
    call(method, params) {
      const id = nextId++
      const done = new Promise((resolve) => waiters.set(id, resolve))
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      return done
    },
    close: () =>
      new Promise((resolve) => {
        child.on('close', resolve)
        child.stdin.end()
      }),
  }
}

test('initialize 는 클라이언트 버전을 협상하고 initialized 알림에는 응답하지 않는다', async () => {
  const mcp = startMcp({ BIZBELL_API_KEY: GOOD_KEY })
  const init = await mcp.call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  })
  assert.equal(init.jsonrpc, '2.0')
  assert.equal(init.result.protocolVersion, '2025-06-18')
  assert.equal(init.result.serverInfo.name, 'bizbell')
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } })

  mcp.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const ping = await mcp.call('ping')
  assert.deepEqual(ping.result, {})

  const unknownVersion = await mcp.call('initialize', { protocolVersion: '1999-01-01', capabilities: {} })
  assert.equal(unknownVersion.result.protocolVersion, '2025-11-25')

  const code = await mcp.close()
  assert.equal(code, 0)
  assert.equal(mcp.lines.length, 3, 'notification 에 대한 응답이 섞이면 안 된다')
})

test('tools/list: 8개 도구, 쓰기 도구에 annotations', async () => {
  const mcp = startMcp({ BIZBELL_API_KEY: GOOD_KEY })
  const { result } = await mcp.call('tools/list')
  const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]))
  assert.deepEqual(Object.keys(byName).sort(), [
    'add_favorite',
    'create_alert',
    'get_alert_matches',
    'get_notice',
    'list_alerts',
    'list_favorites',
    'remove_favorite',
    'search_notices',
  ])
  for (const tool of result.tools) {
    assert.equal(tool.inputSchema.type, 'object')
    assert.equal(tool.call, undefined)
  }
  assert.equal(byName.search_notices.annotations.readOnlyHint, true)
  assert.deepEqual(byName.search_notices.inputSchema.properties.category.items.enum, ['startup', 'bid', 'support', 'rnd'])
  assert.equal(byName.remove_favorite.annotations.destructiveHint, true)
  assert.equal(byName.add_favorite.annotations.destructiveHint, false)
  assert.equal(byName.create_alert.annotations.readOnlyHint, false)
  assert.deepEqual(byName.create_alert.inputSchema.required, ['name', 'category', 'include'])
  await mcp.close()
})

test('tools/call 은 API 를 부르고, 도구 오류는 isError 결과로 돌려준다', async () => {
  const mcp = startMcp({ BIZBELL_API_KEY: GOOD_KEY })
  const search = await mcp.call('tools/call', { name: 'search_notices', arguments: { q: 'AI', category: ['bid', 'startup'], limit: 5 } })
  assert.equal(search.result.isError, undefined)
  assert.equal(JSON.parse(search.result.content[0].text).data.length, 2)
  assert.deepEqual(fake.last().query, { q: 'AI', category: 'bid,startup', limit: '5' })

  const fav = await mcp.call('tools/call', { name: 'add_favorite', arguments: { notice_id: 'kstartup:179363' } })
  assert.equal(JSON.parse(fav.result.content[0].text).data.notice_id, 'kstartup:179363')

  const missing = await mcp.call('tools/call', { name: 'get_notice', arguments: { id: 'nara:none' } })
  assert.equal(missing.result.isError, true)
  assert.equal(JSON.parse(missing.result.content[0].text).error.code, 'not_found')

  const unknownTool = await mcp.call('tools/call', { name: 'nope', arguments: {} })
  assert.equal(unknownTool.error.code, -32602)
  assert.equal((await mcp.call('resources/list')).error.code, -32601)
  await mcp.close()
})

test('잘못된 JSON 은 -32700, 로그인 전 도구 호출은 unauthorized 결과', async () => {
  const mcp = startMcp()
  mcp.write('{not json')
  await mcp.call('ping')
  assert.deepEqual(mcp.lines[0], { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })

  const res = await mcp.call('tools/call', { name: 'list_alerts', arguments: {} })
  assert.equal(res.result.isError, true)
  const { error } = JSON.parse(res.result.content[0].text)
  assert.equal(error.code, 'unauthorized')
  assert.match(error.hint, /bizbell login/)
  await mcp.close()
})
