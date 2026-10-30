import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule, fixture, actor, user, base } from './_enquiry-helpers.mjs'
const { createEnquiry, readEnquiry, listEnquiries } = await loadModule('functions/api/_enquiries.ts')

const make = async (db, extra = {}, who = user) => (await createEnquiry(db, { ...base, ...extra }, who)).json()

test('defaults: stage, priority, brand Unassigned, nullable fields stay null, write_token never exposed', async () => {
  const { db } = fixture()
  const e = await make(db, { brand: undefined })
  assert.equal(e.status, 'New enquiry'); assert.equal(e.priority, 'normal'); assert.equal(e.brand, 'Unassigned')
  for (const k of ['event_date', 'venue', 'guest_count', 'budget', 'next_action_due', 'last_contact_at', 'proposal_url', 'source_url'])
    assert.equal(e[k], null, k)
  assert.match(e.reference, /^ENQ-\d{4}-/)
  assert.equal('write_token' in e, false)
  assert.equal('write_token' in await readEnquiry(db, e.id), false)
  assert.equal(await readEnquiry(db, 'missing'), null)
})

test('only client_name is required; no event date or venue needed', async () => {
  const { db } = fixture()
  assert.equal((await createEnquiry(db, { client_name: 'Only a name' }, user)).status, 201)
  assert.equal((await createEnquiry(db, { ...base, client_name: '  ' }, user)).status, 400)
  assert.equal((await createEnquiry(db, {}, user)).status, 400)
})

test('validation rejects bad input with 400 and writes nothing', async () => {
  const { db, sql } = fixture()
  const bad = [
    { event_date: '2026-02-30' }, { event_date: '27/11/2026' }, { event_date: 20261127 },
    { next_action_due: '2026-13-01' }, { last_contact_at: 'yesterday' }, { last_contact_at: '2026-02-31T10:00:00Z' },
    { contact_email: 'not-an-email' }, { guest_count: -1 }, { guest_count: 1.5 }, { guest_count: '40' },
    { priority: 'asap' }, { status: 'Confirmed' }, { brand: 'Some other brand' },
    { proposal_url: 'javascript:alert(1)' }, { source_url: 'ftp://example.test/x' }, { proposal_url: 'https://user:pw@example.test/x' },
    { client_name: 'x'.repeat(201) }, { brief: 'x'.repeat(5001) }, { company: 7 },
    { id: 'chosen-id' }, { reference: 'X' }, { version: 9 }, { write_token: 'x' }, { created_at: '2000-01-01' },
  ]
  for (const extra of bad) assert.equal((await createEnquiry(db, { ...base, ...extra }, user)).status, 400, JSON.stringify(extra))
  for (const p of [null, [], 'text', 5]) assert.equal((await createEnquiry(db, p, user)).status, 400)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM enquiries').get().n, 0)
})

test('valid optional values are normalised and stored', async () => {
  const { db } = fixture()
  const e = await make(db, {
    event_date: '2028-02-29', guest_count: 0, budget: ' about 1500 ', next_action_due: '2026-11-03',
    last_contact_at: '2026-10-28T09:30:00+01:00', proposal_url: 'https://example.test/p', source_url: 'http://example.test/s', company: '', venue: null,
  })
  assert.equal(e.event_date, '2028-02-29'); assert.equal(e.guest_count, 0); assert.equal(e.budget, 'about 1500')
  assert.equal(e.last_contact_at, '2026-10-28T08:30:00.000Z'); assert.equal(e.company, null); assert.equal(e.venue, null)
})

test('Won cannot be set by an AI actor; users may label Won without creating a booking', async () => {
  const { db, sql } = fixture()
  assert.equal((await createEnquiry(db, { ...base, status: 'Won' }, actor)).status, 403)
  assert.equal((await createEnquiry(db, { ...base, status: 'Won' }, user)).status, 201)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0)
})

test('list: pagination reports global total and has_more, not page size', async () => {
  const { db } = fixture()
  for (let i = 1; i <= 5; i++) await make(db, { client_name: 'Client ' + i })
  const p1 = await (await listEnquiries(db, new URLSearchParams({ limit: '2' }))).json()
  assert.equal(p1.items.length, 2); assert.equal(p1.count, 2); assert.equal(p1.total, 5); assert.equal(p1.has_more, true)
  const p3 = await (await listEnquiries(db, new URLSearchParams({ limit: '2', offset: '4' }))).json()
  assert.equal(p3.items.length, 1); assert.equal(p3.total, 5); assert.equal(p3.has_more, false)
  const ids = new Set([...p1.items, ...(await (await listEnquiries(db, { limit: '2', offset: '2' })).json()).items, ...p3.items].map(x => x.id))
  assert.equal(ids.size, 5)
  assert.equal(p1.items.some(x => 'write_token' in x), false)
  for (const q of [{ limit: '0' }, { limit: '1000' }, { limit: 'x' }, { offset: '-1' }]) assert.equal((await listEnquiries(db, q)).status, 400)
})

test('list: search, status, owner, brand filters with totals for the filtered set', async () => {
  const { db, sql } = fixture()
  await make(db, { client_name: 'Alice Events', owner: 'Sam', event_name: 'Summer 100%_party' })
  await make(db, { client_name: 'Bob Ltd', brand: 'Quirky Hire', owner: 'Jo' })
  const c = await make(db, { client_name: 'Cara', brand: 'Unassigned' })
  sql.prepare("UPDATE enquiries SET status='Proposal sent' WHERE id=?").run(c.id)
  const total = async q => (await (await listEnquiries(db, q)).json()).total
  assert.equal(await total({ q: 'alice' }), 1)
  assert.equal(await total({ q: '100%_' }), 1)
  assert.equal(await total({ q: '%' }), 1)           // wildcard is escaped, only the literal % matches
  assert.equal(await total({ brand: 'Quirky Hire' }), 1)
  assert.equal(await total({ owner: 'Jo' }), 1)
  assert.equal(await total({ owner: 'jo' }), 1)      // owner names match regardless of case
  assert.equal(await total({ status: 'Proposal sent' }), 1)
  assert.equal(await total({ status: 'Won' }), 0)
  assert.equal(await total({ status: 'Bogus' }) , undefined) // 400 has no total
  assert.equal((await listEnquiries(db, { brand: 'Bogus' })).status, 400)
})

test('overdue: open enquiries past their follow-up date, London date, regardless of old event dates', async () => {
  const { db, sql } = fixture()
  const old = await make(db, { client_name: 'Old event', event_date: '2020-01-01', next_action_due: '2026-10-20' })
  await make(db, { client_name: 'Due today', next_action_due: '2026-10-29' })
  await make(db, { client_name: 'Future', next_action_due: '2026-11-30' })
  await make(db, { client_name: 'No date' })
  const lost = await make(db, { client_name: 'Lost one', next_action_due: '2026-10-01' })
  sql.prepare("UPDATE enquiries SET status='Lost' WHERE id=?").run(lost.id)
  // 2026-10-29 23:30 UTC is already 2026-10-29 in London (BST ended 25 Oct); 2026-07-01 23:30 UTC is 2 July in London.
  const now = new Date('2026-10-29T12:00:00Z')
  const res = await (await listEnquiries(db, { overdue: '1' }, now)).json()
  assert.deepEqual(res.items.map(i => i.id), [old.id])
  assert.equal(res.total, 1)
  const all = await (await listEnquiries(db, {}, now)).json()
  assert.equal(all.total, 5); assert.ok(all.items.some(i => i.id === old.id)) // old event dates never hide an open enquiry
  assert.deepEqual(all.summary, { new: 4, due_today: 1, overdue: 1, awaiting: 0, open: 4 })
  const summer = await (await listEnquiries(db, { overdue: '1' }, new Date('2026-07-01T23:30:00Z'))).json()
  assert.equal(summer.summary.due_today, 0)
  const due = await (await listEnquiries(db, { due_today: '1' }, now)).json()
  assert.equal(due.total, 1)
})
