-- Apply once, after 0002. Existing records start at version 1.
ALTER TABLE bookings ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN write_token TEXT;
ALTER TABLE bookings ADD COLUMN outlook_event_id TEXT;
ALTER TABLE bookings ADD COLUMN outlook_event_url TEXT;
