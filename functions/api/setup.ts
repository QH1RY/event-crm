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
    // Enquiry tables mirror migrations/0004_enquiries.sql (new tables only; a test keeps them in step).
    db.prepare(`CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      client_name TEXT NOT NULL,
      company TEXT,
      brand TEXT NOT NULL DEFAULT 'Unassigned' CHECK (brand IN ('Quirky Hire','Photobooths London','Brand Experience Partner','Unassigned')),
      service TEXT,
      event_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      event_date TEXT,
      venue TEXT,
      guest_count INTEGER CHECK (guest_count IS NULL OR guest_count >= 0),
      brief TEXT,
      budget TEXT,
      status TEXT NOT NULL DEFAULT 'New enquiry' CHECK (status IN ('New enquiry','Awaiting details','Proposal sent','Follow-up due','Won','Lost')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
      owner TEXT,
      next_action TEXT,
      next_action_due TEXT,
      last_contact_at TEXT,
      proposal_url TEXT,
      source_url TEXT,
      source_mailbox TEXT,
      source_conversation_id TEXT,
      source_message_id TEXT,
      source_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      write_token TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS enquiry_messages (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT NOT NULL,
      mailbox TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (mailbox, message_id),
      FOREIGN KEY (enquiry_id) REFERENCES enquiries(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS enquiry_audit (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiries_due ON enquiries(next_action_due)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiries_owner ON enquiries(owner)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiries_brand ON enquiries(brand)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiries_updated ON enquiries(updated_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiry_messages_enquiry ON enquiry_messages(enquiry_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_enquiry_audit_enquiry ON enquiry_audit(enquiry_id, created_at DESC)'),
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

  // Idempotent setup for installations that use /api/setup instead of migrations.
  const names = new Set((columns.results || []).map(c => c.name))
  for (const [name, definition] of [
    ['version', 'INTEGER NOT NULL DEFAULT 1'],
    ['write_token', 'TEXT'],
    ['outlook_event_id', 'TEXT'],
    ['outlook_event_url', 'TEXT'],
  ]) {
    if (!names.has(name)) await db.prepare('ALTER TABLE bookings ADD COLUMN '+name+' '+definition).run()
  }

  const checks = await db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('bookings','checklist_items','ai_clients','audit_log','enquiries','enquiry_messages','enquiry_audit')
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
