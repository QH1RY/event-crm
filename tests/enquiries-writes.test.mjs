import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, fixture, actor, user, base } from './_enquiry-helpers.mjs'
const { createEnquiry, readEnquiry, listEnquiries, mutateEnquiry } = await loadModule('functions/api/_enquiries.ts')

const src = (conv, msg = 'm1', mailbox = 'inbox@example.test') => ({ source_mailbox: mailbox, source_conversation_id: conv, source_message_id: msg })
const make = async (db, extra = {}, who = actor) => createEnquiry(db, { ...base, ...extra }, who)
const count = (sql, table = 'enquiries') => sql.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n

test('repeated create for the same mailbox+conversation returns the existing record', async () => {
  const { db, sql } = fixture()
  const first = await make(db, src('c1'))
  const again = await make(db, { ...src('c1', 'm2'), client_name: 'Changed name' })
  assert.equal(first.status, 201); assert.equal(again.status, 200)
  const a = await first.json(), b = await again.json()
  assert.equal(a.id, b.id); assert.equal(b.client_name, base.client_name); assert.equal(b.version, 1)
  assert.equal(count(sql), 1)
  assert.equal(count(sql, 'enquiry_messages'), 2) // both messages linked, once each
})

test('with no conversation, mailbox+message is the key; mailbox is case-insensitive', async () => {
  const { db, sql } = fixture()
  const p = { source_mailbox: 'Inbox@Example.test', source_message_id: 'only-msg' }
  assert.equal((await make(db, p)).status, 201)
  assert.equal((await make(db, { ...p, source_mailbox: 'inbox@example.test' })).status, 200)
  assert.equal((await make(db, { ...p, source_message_id: 'other-msg' })).status, 201)
  assert.equal(count(sql), 2)
})

test('same email in a genuinely different conversation or mailbox is a separate enquiry', async () => {
  const { db, sql } = fixture()
  await make(db, src('c1')); await make(db, src('c2', 'm9')); await make(db, src('c1', 'm1', 'sales@example.test'))
  assert.equal(count(sql), 3)
})

test('a message already linked elsewhere returns its enquiry instead of duplicating', async () => {
  const { db, sql } = fixture()
  const a = await (await make(db, src('c1', 'shared'))).json()
  const again = await make(db, src('c-moved', 'shared'))
  assert.equal(again.status, 200); assert.equal((await again.json()).id, a.id); assert.equal(count(sql), 1)
})

test('manual enquiries without a source are never deduplicated', async () => {
  const { db, sql } = fixture()
  await make(db); await make(db)
  assert.equal(count(sql), 2)
})

test('repeat create never resets the owner\'s status, owner, follow-up, notes or proposal', async () => {
  const { db } = fixture()
  const a = await (await make(db, src('c1'))).json()
  await mutateEnquiry(db, a.id, { version: 1, status: 'Proposal sent', owner: 'Sam', next_action: 'Chase', next_action_due: '2026-11-05', brief: 'Owner notes', proposal_url: 'https://example.test/p' }, user)
  const again = await (await make(db, { ...src('c1', 'm5'), brief: 'Inbound text', status: 'New enquiry' })).json()
  assert.deepEqual([again.status, again.owner, again.next_action, again.next_action_due, again.brief, again.proposal_url, again.version],
    ['Proposal sent', 'Sam', 'Chase', '2026-11-05', 'Owner notes', 'https://example.test/p', 2])
})

test('source validation: ids need a mailbox; Won is never set from a source', async () => {
  const { db, sql } = fixture()
  assert.equal((await make(db, { source_conversation_id: 'c1' })).status, 400)
  assert.equal((await make(db, { source_message_id: 'm1' })).status, 400)
  assert.equal((await make(db, { source_mailbox: 'inbox@example.test' })).status, 400)
  assert.equal((await make(db, { ...src('c1'), status: 'Won' }, user)).status, 400)
  assert.equal((await make(db, { ...src('c1'), status: 'Won' }, actor)).status, 403)
  assert.equal(count(sql), 0)
})

test('concurrent creates for one source produce a single record', async () => {
  const { db, sql } = fixture()
  const res = await Promise.all([make(db, src('race')), make(db, src('race', 'm2')), make(db, src('race'))])
  assert.deepEqual(res.map(r => r.status).sort(), [200, 200, 201])
  assert.equal(new Set(await Promise.all(res.map(async r => (await r.json()).id))).size, 1)
  assert.equal(count(sql), 1)
})

test('create audit failure rolls back the enquiry and its message link', async () => {
  const { db, sql } = fixture()
  sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON enquiry_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  await assert.rejects(make(db, src('c1')))
  assert.equal(count(sql), 0); assert.equal(count(sql, 'enquiry_messages'), 0)
  sql.exec('DROP TRIGGER reject_audit')
  assert.equal((await make(db, src('c1'))).status, 201) // retry succeeds: no half-saved duplicate blocks it
})

test('partial update changes only supplied fields, bumps version, rotates private token, audits', async () => {
  const { db, sql } = fixture()
  const a = await (await make(db, { budget: '£1k', owner: 'Sam' })).json()
  const tok = () => sql.prepare('SELECT write_token AS t FROM enquiries WHERE id=?').get(a.id).t
  const before = tok()
  const res = await mutateEnquiry(db, a.id, { version: 1, status: 'Awaiting details', event_date: '2026-12-01' }, user)
  assert.equal(res.status, 200)
  const b = await res.json()
  assert.deepEqual([b.version, b.status, b.event_date, b.budget, b.owner, b.client_name], [2, 'Awaiting details', '2026-12-01', '£1k', 'Sam', base.client_name])
  assert.equal('write_token' in b, false); assert.notEqual(tok(), before)
  const audit = sql.prepare("SELECT * FROM enquiry_audit WHERE action='enquiry.update'").all()
  assert.equal(audit.length, 1); assert.equal(audit[0].enquiry_id, a.id); assert.equal(audit[0].actor_name, 'CRM user')
  assert.equal(JSON.parse(audit[0].before_json).version, 1); assert.equal('write_token' in JSON.parse(audit[0].before_json), false)
  assert.equal(JSON.parse(audit[0].after_json).patch.status, 'Awaiting details')
  const cleared = await (await mutateEnquiry(db, a.id, { version: 2, event_date: null, budget: '' }, user)).json()
  assert.equal(cleared.event_date, null); assert.equal(cleared.budget, null); assert.equal(cleared.version, 3)
})

test('missing/invalid version is 428, stale is 409, unknown is 404, and nothing is written', async () => {
  const { db, sql } = fixture()
  const a = await (await make(db)).json()
  await mutateEnquiry(db, a.id, { version: 1, owner: 'Sam' }, user)
  for (const v of [undefined, null, 0, 1.5, '1']) assert.equal((await mutateEnquiry(db, a.id, { version: v, owner: 'X' }, user)).status, 428)
  assert.equal((await mutateEnquiry(db, a.id, { owner: 'X' }, user)).status, 428)
  const stale = await mutateEnquiry(db, a.id, { version: 1, owner: 'Stale' }, user)
  assert.equal(stale.status, 409); assert.equal((await stale.json()).version, 2)
  assert.equal((await mutateEnquiry(db, 'nope', { version: 1, owner: 'X' }, user)).status, 404)
  assert.equal((await readEnquiry(db, a.id)).owner, 'Sam')
  assert.equal(count(sql, 'enquiry_audit'), 2)
})

test('invalid or unsupported updates are 400 and never write arbitrary columns', async () => {
  const { db } = fixture()
  const a = await (await make(db, src('c1'))).json()
  const bad = [{}, { source_mailbox: 'x@example.test' }, { source_key: 'x' }, { id: 'z' }, { reference: 'z' }, { write_token: 'z' }, { created_at: 'z' },
    { status: 'Confirmed' }, { client_name: '' }, { event_date: '2026-02-30' }, { guest_count: -3 }, { proposal_url: 'javascript:1' }, { contact_email: 'bad' }]
  for (const extra of bad) assert.equal((await mutateEnquiry(db, a.id, { version: 1, ...extra }, user)).status, 400, JSON.stringify(extra))
  for (const p of [null, [], 'x']) assert.equal((await mutateEnquiry(db, a.id, p, user)).status, 400)
  assert.equal((await readEnquiry(db, a.id)).version, 1)
})

test('Won is a label only: users may set it, AI may not, and no booking is created', async () => {
  const { db, sql } = fixture()
  const a = await (await make(db)).json()
  assert.equal((await mutateEnquiry(db, a.id, { version: 1, status: 'Won' }, actor)).status, 403)
  const won = await mutateEnquiry(db, a.id, { version: 1, status: 'Won' }, user)
  assert.equal(won.status, 200); assert.equal((await won.json()).status, 'Won')
  assert.equal(count(sql, 'bookings'), 0)
})

test('two writers on one version cannot both commit; only one audit entry is written', async () => {
  const { db, sql } = fixture()
  const a = await (await make(db)).json()
  const res = await Promise.all([mutateEnquiry(db, a.id, { version: 1, owner: 'Sam' }, actor), mutateEnquiry(db, a.id, { version: 1, owner: 'Jo' }, user)])
  assert.deepEqual(res.map(r => r.status).sort(), [200, 409])
  assert.equal(count(sql, 'enquiry_audit'), 2) // create + the single winning update
  assert.equal((await readEnquiry(db, a.id)).version, 2)
})

test('audit failure rolls back an update', async () => {
  const { db, sql } = fixture()
  const a = await (await make(db)).json()
  sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON enquiry_audit WHEN NEW.action='enquiry.update' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  await assert.rejects(mutateEnquiry(db, a.id, { version: 1, owner: 'Sam' }, user))
  const e = await readEnquiry(db, a.id)
  assert.equal(e.version, 1); assert.equal(e.owner, null)
})

test('enquiry writes leave bookings, checklist items and booking audit untouched', async () => {
  const { db, sql } = fixture()
  sql.exec("INSERT INTO bookings (id,reference,client_name,event_name,brand,service,event_date) VALUES ('b','B1','Client','Event','Quirky Hire','Booth','2026-11-27')")
  sql.exec("INSERT INTO checklist_items (id,booking_id,title) VALUES ('t','b','Artwork')")
  const snap = () => JSON.stringify([sql.prepare('SELECT * FROM bookings').all(), sql.prepare('SELECT * FROM checklist_items').all(), sql.prepare('SELECT * FROM audit_log').all()])
  const before = snap()
  const a = await (await make(db, src('c1'))).json()
  await mutateEnquiry(db, a.id, { version: 1, status: 'Won', event_date: '2026-11-27' }, user)
  await listEnquiries(db, {})
  assert.equal(snap(), before)
})

test('the module offers no way to delete or archive enquiries', async () => {
  const mod = await loadModule('functions/api/_enquiries.ts')
  for (const k of Object.keys(mod)) assert.doesNotMatch(k, /delete|archive|remove/i)
})
