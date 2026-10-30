-- Enquiries are pre-booking leads. They are NOT bookings and never require an event date or venue.
-- Idempotent: creates new tables/indexes only. Existing booking data is not touched.
CREATE TABLE IF NOT EXISTS enquiries (
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
);

-- Every source message linked to an enquiry. (mailbox, message) is unique so a message is never saved twice.
CREATE TABLE IF NOT EXISTS enquiry_messages (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mailbox, message_id),
  FOREIGN KEY (enquiry_id) REFERENCES enquiries(id)
);

CREATE TABLE IF NOT EXISTS enquiry_audit (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);
CREATE INDEX IF NOT EXISTS idx_enquiries_due ON enquiries(next_action_due);
CREATE INDEX IF NOT EXISTS idx_enquiries_owner ON enquiries(owner);
CREATE INDEX IF NOT EXISTS idx_enquiries_brand ON enquiries(brand);
CREATE INDEX IF NOT EXISTS idx_enquiries_updated ON enquiries(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiry_messages_enquiry ON enquiry_messages(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_audit_enquiry ON enquiry_audit(enquiry_id, created_at DESC);
