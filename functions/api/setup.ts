interface Env {
  DB: D1Database
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

async function initialise(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      client_name TEXT NOT NULL,
      company TEXT,
      event_name TEXT NOT NULL,
      brand TEXT NOT NULL,
      service TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Confirmed',
      event_date TEXT NOT NULL,
      event_start TEXT,
      event_end TEXT,
      access_time TEXT,
      setup_ready_by TEXT,
      collection_time TEXT,
      venue TEXT,
      venue_address TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS checklist_items (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      owner TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      can_read INTEGER NOT NULL DEFAULT 1,
      can_create INTEGER NOT NULL DEFAULT 1,
      can_update INTEGER NOT NULL DEFAULT 1,
      can_archive INTEGER NOT NULL DEFAULT 0,
      can_delete INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      booking_id TEXT,
      actor_type TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_bookings_event_date ON bookings(event_date)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_checklist_booking ON checklist_items(booking_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_audit_booking ON audit_log(booking_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_name, created_at DESC)'),
  ])

  const columns = await db.prepare('PRAGMA table_info(bookings)').all<{ name: string }>()
  const hasArchivedAt = (columns.results || []).some((c) => c.name === 'archived_at')
  if (!hasArchivedAt) {
    await db.prepare('ALTER TABLE bookings ADD COLUMN archived_at TEXT').run()
  }

  const checks = await db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('bookings','checklist_items','ai_clients','audit_log')
    ORDER BY name
  `).all<{ name: string }>()

  return {
    ok: true,
    database: 'event-crm-db',
    tables: (checks.results || []).map((row) => row.name),
    archived_column: true,
    message: 'Event CRM database initialised successfully.'
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    return json(await initialise(env.DB))
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }
}

export const onRequestPost = onRequestGet
