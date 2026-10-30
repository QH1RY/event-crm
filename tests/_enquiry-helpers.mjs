// Shared test helpers: real in-memory SQLite behind a transactional D1-style adapter,
// and a loader that strips TypeScript and inlines relative imports as data URLs.
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const root = fileURLToPath(new URL('..', import.meta.url))
const cache = new Map()

export function loadSource(path) {
  const abs = resolve(root, path)
  if (cache.has(abs)) return cache.get(abs)
  let source = stripTypeScriptTypes(readFileSync(abs, 'utf8'))
  source = source.replace(/from ['"](\.[^'"]+)['"]/g, (_, ref) =>
    "from '" + loadSource(resolve(dirname(abs), ref + '.ts')) + "'")
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  cache.set(abs, url)
  return url
}
export const loadModule = path => import(loadSource(path))

export const MIGRATIONS = ['0001_init.sql', '0002_ai_access.sql', '0003_concurrent_updates.sql', '0004_enquiries.sql']

export function fixture(files = MIGRATIONS) {
  const sql = new DatabaseSync(':memory:')
  for (const file of files) sql.exec(readFileSync(resolve(root, 'migrations', file), 'utf8'))
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
  return { db, sql }
}

export const actor = { name: 'Hermes', type: 'ai' }
export const user = { name: 'CRM user', type: 'user' }
export const base = { client_name: 'Local test client', contact_email: 'client@example.test', brand: 'Photobooths London', service: 'Photo booth' }
