// Enquiry persistence. Enquiries are pre-booking leads; nothing here creates or confirms a booking.
// Keep this module free of relative imports so the test loader can load it on its own.
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export type Actor = { name: string; type: 'ai' | 'user' }

export const STAGES = ['New enquiry', 'Awaiting details', 'Proposal sent', 'Follow-up due', 'Won', 'Lost']
export const BRANDS = ['Quirky Hire', 'Photobooths London', 'Brand Experience Partner', 'Unassigned']
export const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const OPEN = "status NOT IN ('Won','Lost')"

const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const textLimits: Record<string, number> = {
  client_name: 200, company: 200, service: 200, event_name: 200, contact_email: 254, contact_phone: 50,
  venue: 300, brief: 5000, budget: 100, owner: 100, next_action: 500,
}
const urlFields = ['proposal_url', 'source_url']
const sourceFields = ['source_mailbox', 'source_conversation_id', 'source_message_id']
const sourceLimits: Record<string, number> = { source_mailbox: 254, source_conversation_id: 512, source_message_id: 512 }
const editable = [...Object.keys(textLimits), ...urlFields, 'brand', 'status', 'priority', 'event_date', 'next_action_due', 'last_contact_at', 'guest_count']

const validDate = (v: any) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(v + 'T00:00:00Z')
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const validEmail = (v: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)
const validUrl = (v: string) => {
  try { const u = new URL(v); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password } catch { return false }
}

// Returns the cleaned column values for the supplied keys, or an error message. Unknown keys are rejected.
function clean(p: any, allowed: string[]): { values: Record<string, any> } | { error: string } {
  const values: Record<string, any> = {}
  p = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) // undefined cannot occur in JSON: treat as absent
  for (const k of Object.keys(p)) if (!allowed.includes(k)) return { error: k + ' is not a supported field' }
  for (const k of allowed) {
    if (!has(p, k)) continue
    let v = p[k]
    if (k === 'guest_count') {
      if (v !== null && !(Number.isSafeInteger(v) && v >= 0)) return { error: 'guest_count must be a whole number, zero or more, or null' }
    } else if (k === 'brand' || k === 'status' || k === 'priority') {
      const list = k === 'brand' ? BRANDS : k === 'status' ? STAGES : PRIORITIES
      if (typeof v !== 'string' || !list.includes(v)) return { error: k + ' must be one of: ' + list.join(', ') }
    } else {
      if (v !== null && typeof v !== 'string') return { error: k + ' must be text or null' }
      if (typeof v === 'string') { v = v.trim(); if (v === '') v = null }
      const limit = textLimits[k] ?? sourceLimits[k] ?? (urlFields.includes(k) ? 2000 : 0)
      if (v !== null && limit && v.length > limit) return { error: k + ' must be at most ' + limit + ' characters' }
      if (k === 'client_name' && v === null) return { error: 'client_name cannot be empty' }
      if (v !== null) {
        if (k === 'event_date' || k === 'next_action_due') { if (!validDate(v)) return { error: k + ' must be a real date as YYYY-MM-DD, or null' } }
        else if (k === 'last_contact_at') {
          const m = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(v)
          const t = m ? Date.parse(v) : NaN
          if (!m || !validDate(m[1]) || isNaN(t)) return { error: 'last_contact_at must be an ISO date-time, or null' }
          v = new Date(t).toISOString()
        }
        else if (k === 'contact_email' && !validEmail(v)) return { error: 'contact_email is not a valid email address' }
        else if (urlFields.includes(k) && !validUrl(v)) return { error: k + ' must be an http(s) URL without embedded credentials' }
      }
    }
    values[k] = v
  }
  return { values }
}

export const londonToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

export async function readEnquiry(db: D1Database, id: string) {
  const e = await db.prepare('SELECT * FROM enquiries WHERE id=?').bind(id).first<any>()
  if (!e) return null
  delete e.write_token
  return e
}

export async function createEnquiry(db: D1Database, p: any, actor: Actor) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return json({ error: 'Expected a JSON object' }, 400)
  const c = clean(p, [...editable, ...sourceFields])
  if ('error' in c) return json({ error: c.error }, 400)
  const v = c.values
  if (!v.client_name) return json({ error: 'client_name is required' }, 400)
  if (v.status === 'Won' && actor.type === 'ai') return json({ error: 'Only a person can mark an enquiry as Won' }, 403)
  const hasSource = sourceFields.some(k => v[k])
  if (hasSource) {
    if (!v.source_mailbox || !(v.source_conversation_id || v.source_message_id)) return json({ error: 'A source needs source_mailbox and a conversation or message id' }, 400)
    if (v.status === 'Won') return json({ error: 'An enquiry created from a source message cannot start as Won' }, 400)
    v.source_mailbox = v.source_mailbox.toLowerCase()
  }
  // Stable source key: mailbox + conversation, otherwise mailbox + message.
  const key = hasSource ? (v.source_conversation_id ? 'c|' + v.source_mailbox + '|' + v.source_conversation_id : 'm|' + v.source_mailbox + '|' + v.source_message_id) : null
  if (key) v.source_key = key
  // An already saved source record is returned untouched; only the message link is added.
  const existing = async () => {
    if (!key) return null
    let row = await db.prepare('SELECT id FROM enquiries WHERE source_key=?').bind(key).first<any>()
    if (!row && v.source_message_id) row = await db.prepare('SELECT enquiry_id AS id FROM enquiry_messages WHERE mailbox=? AND message_id=?').bind(v.source_mailbox, v.source_message_id).first<any>()
    if (!row) return null
    if (v.source_message_id) await db.prepare('INSERT OR IGNORE INTO enquiry_messages (id,enquiry_id,mailbox,message_id) VALUES (?,?,?,?)')
      .bind(crypto.randomUUID(), row.id, v.source_mailbox, v.source_message_id).run()
    return json(await readEnquiry(db, row.id), 200)
  }
  const found = await existing()
  if (found) return found
  const cols = Object.keys(v)
  for (let attempt = 0; ; attempt++) {
    const id = crypto.randomUUID()
    const reference = 'ENQ-' + new Date().getFullYear() + '-' + id.slice(0, 6).toUpperCase()
    const statements = [db.prepare('INSERT INTO enquiries (id,reference,' + cols.join(',') + ') VALUES (?,?,' + cols.map(() => '?').join(',') + ')')
      .bind(id, reference, ...cols.map(k => v[k]))]
    if (v.source_message_id) statements.push(db.prepare('INSERT INTO enquiry_messages (id,enquiry_id,mailbox,message_id) VALUES (?,?,?,?)')
      .bind(crypto.randomUUID(), id, v.source_mailbox, v.source_message_id))
    statements.push(db.prepare('INSERT INTO enquiry_audit (id,enquiry_id,actor_type,actor_name,action,summary,after_json) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), id, actor.type, actor.name, 'enquiry.create', 'Created ' + reference, JSON.stringify({ ...v, id, reference })))
    try {
      await db.batch(statements) // enquiry, message link and audit commit together
      return json(await readEnquiry(db, id), 201)
    } catch (e) {
      // A concurrent writer may have saved the same source first, or the random reference may have collided.
      const raced = await existing()
      if (raced) return raced
      if (attempt < 2 && /enquiries\.reference/.test(String((e as any)?.message))) continue
      throw e
    }
  }
}

export async function mutateEnquiry(db: D1Database, id: string, p: any, actor: Actor) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return json({ error: 'Expected a JSON object' }, 400)
  if (!Number.isSafeInteger(p.version) || p.version < 1) return json({ error: 'Read the enquiry first and supply its integer version' }, 428)
  const { version, ...rest } = p
  const c = clean(rest, editable)
  if ('error' in c) return json({ error: c.error }, 400)
  const keys = Object.keys(c.values)
  if (!keys.length) return json({ error: 'No supported changes supplied' }, 400)
  if (c.values.status === 'Won' && actor.type === 'ai') return json({ error: 'Only a person can mark an enquiry as Won' }, 403)
  const before = await readEnquiry(db, id)
  if (!before) return json({ error: 'Enquiry not found' }, 404)
  if (before.version !== version) return json({ error: 'This enquiry changed. Read it again and reapply only your intended change.', version: before.version }, 409)
  const token = crypto.randomUUID()
  const guard = 'EXISTS (SELECT 1 FROM enquiries WHERE id=? AND write_token=?)'
  const claim = db.prepare('UPDATE enquiries SET ' + [...keys.map(k => k + '=?'), 'version=version+1', 'write_token=?', 'updated_at=CURRENT_TIMESTAMP'].join(',') + ' WHERE id=? AND version=?')
    .bind(...keys.map(k => c.values[k]), token, id, version)
  // Audit is written only if this writer's claim succeeded, and commits or rolls back with the change.
  const audit = db.prepare('INSERT INTO enquiry_audit (id,enquiry_id,actor_type,actor_name,action,summary,before_json,after_json) SELECT ?,?,?,?,?,?,?,? WHERE ' + guard)
    .bind(crypto.randomUUID(), id, actor.type, actor.name, 'enquiry.update', 'Version ' + version + ' to ' + (version + 1), JSON.stringify(before), JSON.stringify({ patch: c.values, version: version + 1 }), id, token)
  const result = await db.batch([claim, audit])
  if (!result[0].meta.changes) return json({ error: 'Another writer saved first. Read the enquiry again before retrying.' }, 409)
  return json(await readEnquiry(db, id))
}

export async function listEnquiries(db: D1Database, query: URLSearchParams | Record<string, any> = {}, now = new Date()) {
  const get = (k: string) => { const v = query instanceof URLSearchParams ? query.get(k) : (query as any)[k]; return v === undefined || v === null ? '' : String(v).trim() }
  const where: string[] = [], binds: any[] = []
  const today = londonToday(now)
  const q = get('q')
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'
    where.push('(' + ['reference', 'client_name', 'company', 'event_name', 'service', 'contact_email', 'venue', 'brief', 'next_action'].map(c => c + " LIKE ? ESCAPE '\\'").join(' OR ') + ')')
    for (let i = 0; i < 9; i++) binds.push(like)
  }
  for (const [k, list] of [['status', STAGES], ['brand', BRANDS]] as const) {
    const v = get(k)
    if (!v) continue
    if (!list.includes(v)) return json({ error: k + ' must be one of: ' + list.join(', ') }, 400)
    where.push(k + '=?'); binds.push(v)
  }
  if (get('owner')) { where.push('owner=? COLLATE NOCASE'); binds.push(get('owner')) }
  const flag = (k: string) => ['1', 'true'].includes(get(k).toLowerCase())
  if (flag('overdue')) { where.push(OPEN + ' AND next_action_due < ?'); binds.push(today) }
  if (flag('due_today')) { where.push(OPEN + ' AND next_action_due = ?'); binds.push(today) }
  for (const [k, min, max] of [['limit', 1, 200], ['offset', 0, Number.MAX_SAFE_INTEGER]] as const) {
    if (get(k) && (!/^\d+$/.test(get(k)) || +get(k) < min || +get(k) > max)) return json({ error: k + ' must be a whole number from ' + min + (k === 'limit' ? ' to ' + max : '') }, 400)
  }
  const limit = get('limit') ? +get('limit') : 50, offset = get('offset') ? +get('offset') : 0
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM enquiries' + clause).bind(...binds).first<any>()).n
  const { results } = await db.prepare('SELECT * FROM enquiries' + clause + ' ORDER BY updated_at DESC, created_at DESC, id LIMIT ? OFFSET ?').bind(...binds, limit, offset).all<any>()
  // Summary covers every open enquiry, independent of filters and paging.
  const s = await db.prepare(
    "SELECT COUNT(*) AS open, COALESCE(SUM(status='New enquiry'),0) AS new, COALESCE(SUM(next_action_due=?),0) AS due_today, " +
    "COALESCE(SUM(next_action_due<?),0) AS overdue, COALESCE(SUM(status IN ('Awaiting details','Proposal sent')),0) AS awaiting FROM enquiries WHERE " + OPEN
  ).bind(today, today).first<any>()
  const items = results.map(e => { delete e.write_token; return e })
  return json({
    items, count: items.length, total, limit, offset, has_more: offset + items.length < total,
    summary: { new: s.new, due_today: s.due_today, overdue: s.overdue, awaiting: s.awaiting, open: s.open },
  })
}
