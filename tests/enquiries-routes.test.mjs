import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadModule, fixture, base } from './_enquiry-helpers.mjs'

const route = p => loadModule('functions/api/' + p)
const aiList = await route('ai/enquiries/index.ts'), aiOne = await route('ai/enquiries/[id]/index.ts')
const webList = await route('enquiries/index.ts'), webOne = await route('enquiries/[id]/index.ts')
const middleware = await route('_middleware.ts'), setup = await route('setup.ts')
const { sha256 } = await route('ai/_auth.ts')

const url = '/api/ai/enquiries'
const req = (path, method = 'GET', body, token) => new Request('https://crm.example.test' + path, {
  method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
})
async function client(sql, token, perms = {}) {
  const p = { can_read: 1, can_create: 1, can_update: 1, ...perms }
  sql.prepare('INSERT INTO ai_clients (id,name,key_hash,can_read,can_create,can_update) VALUES (?,?,?,?,?,?)')
    .run(token, 'Test ' + token, await sha256(token), p.can_read, p.can_create, p.can_update)
}
const call = (mod, fn, db, request, id) => mod[fn]({ env: { DB: db }, request, params: id ? { id } : {} })

test('enquiry routes expose no delete, archive or replace handlers', () => {
  for (const mod of [aiList, aiOne, webList, webOne]) for (const k of Object.keys(mod)) assert.match(k, /^onRequest(Get|Post|Patch)$/)
  for (const f of ['ai/enquiries/[id]/archive', 'enquiries/[id]/archive']) assert.equal(existsSync(fileURLToPath(new URL('../functions/api/' + f + '.ts', import.meta.url))), false)
})

test('AI routes: unauthenticated and invalid bearer tokens are rejected', async () => {
  const { db, sql } = fixture(); await client(sql, 'good')
  for (const t of [undefined, 'wrong']) {
    assert.equal((await call(aiList, 'onRequestGet', db, req(url, 'GET', undefined, t))).status, 401)
    assert.equal((await call(aiList, 'onRequestPost', db, req(url, 'POST', base, t))).status, 401)
    assert.equal((await call(aiOne, 'onRequestGet', db, req(url + '/x', 'GET', undefined, t), 'x')).status, 401)
    assert.equal((await call(aiOne, 'onRequestPatch', db, req(url + '/x', 'PATCH', { version: 1 }, t), 'x')).status, 401)
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n, 0)
})

test('AI routes require read, create and update permissions separately', async () => {
  const { db, sql } = fixture()
  await client(sql, 'all'); await client(sql, 'noread', { can_read: 0 }); await client(sql, 'nocreate', { can_create: 0 }); await client(sql, 'noupdate', { can_update: 0 })
  const made = await call(aiList, 'onRequestPost', db, req(url, 'POST', base, 'all'))
  assert.equal(made.status, 201); const e = await made.json()
  assert.equal((await call(aiList, 'onRequestGet', db, req(url, 'GET', undefined, 'noread'))).status, 403)
  assert.equal((await call(aiOne, 'onRequestGet', db, req(url + '/' + e.id, 'GET', undefined, 'noread'), e.id)).status, 403)
  assert.equal((await call(aiList, 'onRequestPost', db, req(url, 'POST', base, 'nocreate'))).status, 403)
  assert.equal((await call(aiOne, 'onRequestPatch', db, req(url + '/' + e.id, 'PATCH', { version: 1, owner: 'x' }, 'noupdate'), e.id)).status, 403)
  // read-only-style clients can still do what they are allowed to
  assert.equal((await call(aiList, 'onRequestGet', db, req(url, 'GET', undefined, 'nocreate'))).status, 200)
  assert.equal((await call(aiOne, 'onRequestPatch', db, req(url + '/' + e.id, 'PATCH', { version: 1, owner: 'x' }, 'nocreate'), e.id)).status, 200)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n, 1)
})

test('AI routes: list/read/create/dedupe/patch end to end, with the client recorded in the audit', async () => {
  const { db, sql } = fixture(); await client(sql, 'hermes')
  const payload = { ...base, source_mailbox: 'inbox@example.test', source_conversation_id: 'thread-1', source_message_id: 'msg-1' }
  const a = await call(aiList, 'onRequestPost', db, req(url, 'POST', payload, 'hermes'))
  const again = await call(aiList, 'onRequestPost', db, req(url, 'POST', payload, 'hermes'))
  assert.deepEqual([a.status, again.status], [201, 200])
  const e = await a.json()
  const list = await (await call(aiList, 'onRequestGet', db, req(url + '?q=Local&limit=10', 'GET', undefined, 'hermes'))).json()
  assert.equal(list.total, 1); assert.equal('write_token' in list.items[0], false)
  const one = await call(aiOne, 'onRequestGet', db, req(url + '/' + e.id, 'GET', undefined, 'hermes'), e.id)
  assert.equal((await one.json()).event_date, null)
  assert.equal((await call(aiOne, 'onRequestGet', db, req(url + '/nope', 'GET', undefined, 'hermes'), 'nope')).status, 404)
  const patched = await call(aiOne, 'onRequestPatch', db, req(url + '/' + e.id, 'PATCH', { version: 1, status: 'Awaiting details' }, 'hermes'), e.id)
  assert.equal(patched.status, 200)
  assert.equal((await call(aiOne, 'onRequestPatch', db, req(url + '/' + e.id, 'PATCH', { version: 1, owner: 'x' }, 'hermes'), e.id)).status, 409)
  assert.equal((await call(aiOne, 'onRequestPatch', db, req(url + '/' + e.id, 'PATCH', { status: 'Awaiting details' }, 'hermes'), e.id)).status, 428)
  assert.equal((await call(aiOne, 'onRequestPatch', db, req(url + '/' + e.id, 'PATCH', { version: 2, status: 'Won' }, 'hermes'), e.id)).status, 403)
  const rows = sql.prepare('SELECT actor_type,actor_name FROM enquiry_audit ORDER BY created_at').all()
  assert.ok(rows.length >= 2 && rows.every(r => r.actor_type === 'ai' && r.actor_name === 'Test hermes'))
})

test('routes return 400 for invalid JSON bodies', async () => {
  const { db, sql } = fixture(); await client(sql, 'hermes')
  const e = await (await call(aiList, 'onRequestPost', db, req(url, 'POST', base, 'hermes'))).json()
  for (const [mod, fn, path, id, t] of [[aiList, 'onRequestPost', url, undefined, 'hermes'], [aiOne, 'onRequestPatch', url + '/' + e.id, e.id, 'hermes'], [webList, 'onRequestPost', '/api/enquiries'], [webOne, 'onRequestPatch', '/api/enquiries/' + e.id, e.id]])
    for (const body of ['{not json', '', 'null'])
      assert.equal((await call(mod, fn, db, req(path, fn.slice(9).toUpperCase(), body, t), id)).status, 400, fn + ' ' + JSON.stringify(body))
})

test('browser routes work for the signed-in team and record a user actor', async () => {
  const { db, sql } = fixture()
  const made = await call(webList, 'onRequestPost', db, req('/api/enquiries', 'POST', { ...base, event_date: null }))
  assert.equal(made.status, 201); const e = await made.json()
  assert.equal((await (await call(webList, 'onRequestGet', db, req('/api/enquiries?status=New%20enquiry'))).json()).total, 1)
  assert.equal((await call(webList, 'onRequestGet', db, req('/api/enquiries?limit=bad'))).status, 400)
  assert.equal((await call(webOne, 'onRequestGet', db, req('/api/enquiries/' + e.id), e.id)).status, 200)
  assert.equal((await call(webOne, 'onRequestGet', db, req('/api/enquiries/nope'), 'nope')).status, 404)
  const p = await call(webOne, 'onRequestPatch', db, req('/api/enquiries/' + e.id, 'PATCH', { version: 1, status: 'Won' }), e.id)
  assert.equal(p.status, 200)
  assert.equal(sql.prepare("SELECT actor_type FROM enquiry_audit WHERE action='enquiry.update'").get().actor_type, 'user')
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0)
})

test('Access middleware protects every /api/enquiries route; AI bearer does not unlock browser routes', async () => {
  const next = () => Response.json({ leaked: true })
  const mk = (path, headers = {}) => new Request('https://crm.example.test' + path, { headers })
  for (const path of ['/api/enquiries', '/api/enquiries/', '/api/enquiries/abc', '/api/enquiries/abc/anything']) {
    assert.equal((await middleware.onRequest({ request: mk(path), env: {}, next })).status, 503, path + ' unconfigured')
    const env = { ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'aud' }
    assert.equal((await middleware.onRequest({ request: mk(path), env, next })).status, 401, path + ' no JWT')
    assert.equal((await middleware.onRequest({ request: mk(path, { authorization: 'Bearer good' }), env, next })).status, 401, path + ' bearer only')
    assert.equal((await middleware.onRequest({ request: mk(path, { 'Cf-Access-Jwt-Assertion': 'a.b.c' }), env, next })).status, 401, path + ' forged JWT')
  }
  for (const path of ['/api/ai/enquiries', '/api/ai/enquiries/abc']) // bearer handling stays in the AI routes
    assert.equal((await (await middleware.onRequest({ request: mk(path), env: {}, next })).json()).leaked, true)
})

test('/api/setup adds enquiry tables non-destructively and matches migration 0004', async () => {
  const fromMigrations = fixture().sql
  const shape = s => JSON.stringify(['enquiries', 'enquiry_messages', 'enquiry_audit'].map(t => s.prepare('PRAGMA table_info(' + t + ')').all().map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk])))
  const idx = s => s.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_enq%' ORDER BY name").all().map(r => r.name)
  const { db, sql } = fixture([])
  const run = async () => { const r = await setup.onRequestGet({ env: { DB: db } }); assert.equal(r.status, 200); return r.json() }
  const first = await run()
  sql.exec("INSERT INTO bookings (id,reference,client_name,event_name,brand,service,event_date) VALUES ('b','B1','Client','Event','Quirky Hire','Booth','2026-11-27')")
  sql.exec("INSERT INTO enquiries (id,reference,client_name) VALUES ('e','ENQ-1','Kept')")
  const second = await run()
  assert.ok(first.tables.includes('enquiries') && second.tables.includes('enquiry_audit'))
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 1)
  assert.equal(sql.prepare('SELECT client_name FROM enquiries').get().client_name, 'Kept')
  assert.equal(shape(sql), shape(fromMigrations)); assert.deepEqual(idx(sql), idx(fromMigrations))
  // Also safe on a database that already has every migration applied.
  const full = fixture(); const r = await setup.onRequestGet({ env: { DB: full.db } }); assert.equal(r.status, 200)
})
