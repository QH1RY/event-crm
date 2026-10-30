import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

// Initial vertical slice: a genuine enquiry must not require a fabricated event date.
test('new enquiry can be saved with unknown event date without creating a booking', async () => {
  const modulePath = new URL('../functions/api/_enquiries.ts', import.meta.url)
  assert.ok(existsSync(modulePath), 'The enquiries persistence module is not implemented yet')
  const migration = new URL('../migrations/0004_enquiries.sql', import.meta.url)
  assert.ok(existsSync(migration), 'The enquiry schema is not implemented yet')
  const sql = new DatabaseSync(':memory:')
  for (const file of ['0001_init.sql', '0002_ai_access.sql', '0003_concurrent_updates.sql', '0004_enquiries.sql']) {
    sql.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'))
  }
  class Statement {
    constructor(query, args = []) { this.query = query; this.args = args }
    bind(...args) { return new Statement(this.query, args) }
    async first() { return sql.prepare(this.query).get(...this.args) || null }
    async all() { return { results: sql.prepare(this.query).all(...this.args) } }
    runSync() { const r = sql.prepare(this.query).run(...this.args); return { meta: { changes: Number(r.changes) } } }
    async run() { return this.runSync() }
  }
  const db = { prepare: q => new Statement(q), batch: async statements => {
    sql.exec('BEGIN IMMEDIATE')
    try { const out = statements.map(s => s.runSync()); sql.exec('COMMIT'); return out }
    catch (e) { sql.exec('ROLLBACK'); throw e }
  } }
  const source = stripTypeScriptTypes(readFileSync(modulePath, 'utf8'))
  const { createEnquiry } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  const response = await createEnquiry(db, {
    client_name: 'Local test client', contact_email: 'client@example.test',
    event_name: 'Christmas party enquiry', brand: 'Photobooths London',
    service: 'Self-service photo booth', event_date: null,
    brief: 'Please quote for a self-service photo booth.',
    source_mailbox: 'inbox@example.test', source_conversation_id: 'test-thread-1', source_message_id: 'test-message-1'
  }, { name: 'Hermes', type: 'ai' })
  assert.equal(response.status, 201)
  const enquiry = await response.json()
  assert.equal(enquiry.event_date, null)
  assert.equal(enquiry.status, 'New enquiry')
  assert.equal(enquiry.version, 1)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0)
  sql.close()
})
