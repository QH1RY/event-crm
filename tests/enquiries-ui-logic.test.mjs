import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from './_enquiry-helpers.mjs'
const L = await loadModule('src/enquiryLogic.ts')

const enquiry = (extra = {}) => ({
  id: 'e1', reference: 'ENQ-1', version: 3, client_name: 'Client', company: null, brand: 'Unassigned', service: null, event_name: null,
  contact_email: null, contact_phone: null, event_date: null, venue: null, guest_count: null, brief: null, budget: null,
  status: 'New enquiry', priority: 'normal', owner: null, next_action: null, next_action_due: null, last_contact_at: null,
  proposal_url: null, source_url: null, ...extra,
})

test('London date follows Europe/London, not UTC', () => {
  assert.equal(L.londonToday(new Date('2026-07-01T23:30:00Z')), '2026-07-02') // BST
  assert.equal(L.londonToday(new Date('2026-12-01T23:30:00Z')), '2026-12-01') // GMT
})

test('an unedited form produces an empty patch; unknown dates stay null, never invented', () => {
  const e = enquiry({ guest_count: 40, last_contact_at: '2026-10-28T08:30:00.000Z', event_date: null })
  const form = L.toForm(e)
  assert.equal(form.event_date, ''); assert.equal(form.guest_count, '40')
  assert.deepEqual(L.buildPatch(e, form), {})
})

test('patch contains only changed fields with correct types', () => {
  const e = enquiry({ owner: 'Sam', event_date: '2026-12-01', guest_count: 40 })
  const form = { ...L.toForm(e), owner: ' Jo ', event_date: '', guest_count: '75', status: 'Proposal sent', company: '', next_action_due: '2026-11-04' }
  assert.deepEqual(L.buildPatch(e, form), { owner: 'Jo', event_date: null, guest_count: 75, status: 'Proposal sent', next_action_due: '2026-11-04' })
  assert.deepEqual(L.buildPatch(e, { ...L.toForm(e), guest_count: '' }), { guest_count: null })
})

test('a create body from a blank form only contains what was typed', () => {
  assert.deepEqual(L.buildPatch(null, { ...L.toForm(null), client_name: 'New client', event_date: '' }), { client_name: 'New client' })
  assert.deepEqual(L.buildPatch(null, { ...L.toForm(null), client_name: 'A', status: 'Awaiting details', guest_count: '0' }), { client_name: 'A', status: 'Awaiting details', guest_count: 0 })
})

test('last contact round-trips through the local datetime input', () => {
  const iso = '2026-10-28T08:30:00.000Z'
  assert.equal(L.localInputToIso(L.isoToLocalInput(iso)), iso)
  assert.equal(L.isoToLocalInput(null), ''); assert.equal(L.localInputToIso(''), null)
})

test('due state: overdue/today/upcoming only for open enquiries; old event dates never close one', () => {
  const t = '2026-10-29'
  assert.equal(L.dueState(enquiry({ next_action_due: '2026-10-28' }), t), 'overdue')
  assert.equal(L.dueState(enquiry({ next_action_due: t }), t), 'today')
  assert.equal(L.dueState(enquiry({ next_action_due: '2026-11-01' }), t), 'upcoming')
  assert.equal(L.dueState(enquiry({}), t), 'none')
  assert.equal(L.dueState(enquiry({ next_action_due: '2026-10-01', status: 'Lost' }), t), 'closed')
  assert.equal(L.dueState(enquiry({ event_date: '2019-01-01', next_action_due: '2026-10-28' }), t), 'overdue')
})

test('only http(s) links are ever rendered as links', () => {
  assert.equal(L.safeHttpUrl('https://example.test/a'), 'https://example.test/a')
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.test', '', null, undefined, 'not a url']) assert.equal(L.safeHttpUrl(bad), null)
})

test('conflict rebase keeps unsaved edits and reports where the latest server value differs', () => {
  const base = enquiry({ owner: 'Sam', next_action: 'Call' })
  const mine = { ...L.toForm(base), owner: 'Jo', brief: 'my unsaved brief' }
  const latest = enquiry({ version: 4, owner: 'Alex', next_action: 'Email', brief: 'server brief' })
  const r = L.rebaseForm(base, mine, latest)
  assert.equal(r.form.owner, 'Jo'); assert.equal(r.form.brief, 'my unsaved brief') // my edits kept
  assert.equal(r.form.next_action, 'Email')                                      // untouched fields refresh
  assert.deepEqual(r.conflicts.sort(), ['brief', 'owner'])                        // edited fields that someone else also changed
  assert.deepEqual(L.buildPatch(latest, r.form), { owner: 'Jo', brief: 'my unsaved brief' })
})
