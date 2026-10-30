# Enquiry CRM

Tracks new incoming enquiries before they become confirmed bookings. This is a separate pipeline: **an enquiry is not a booking**, needs no event date or venue, and never creates or changes a booking.

## Current state
This change adds the CRM tables, API, controlled assistant API and browser UI. It has not been deployed, and no enquiry records exist in any production database. **Automatic inbox ingestion and scheduled monitoring are not active.** They need a host to be set up and activated separately (see "Inbox ingestion"). Until then enquiries are captured manually in the browser, or by an authorised assistant calling the API.

## Features
- Enquiries page with pipeline (one column per stage) and list layouts, reachable from the **Enquiries** navigation entry; each enquiry has its own address, `/enquiries/:id`.
- Manual capture and edit of client, company, contact email/phone, brand, service, event name, event date, venue, guests, budget, brief, stage, priority, owner, next action, due date, last contact, proposal link and source link.
- Search (client, company, event, service, email, venue, brief, reference), and stage / brand / owner / overdue filters.
- Summary: **New**, **Due today**, **Overdue**, **Awaiting reply**, using the Europe/London date. They count every open enquiry whatever the filters or page. Awaiting reply means stage *Awaiting details* or *Proposal sent*.
- Open enquiries are never hidden or auto-closed because an event date has passed or is missing.
- Optimistic concurrency: edits carry the enquiry's integer `version`. After a conflict the form keeps your unsaved edits; you can reload the latest copy on top of them (fields someone else also changed are flagged) or discard your edits, then save again deliberately. Nothing is retried automatically.
- Audit trail in the new `enquiry_audit` table (actor, action, before/after). Enquiry writes do not touch `audit_log` or any booking.
- Enquiries cannot be deleted or archived. There are no such endpoints or controls.

## Stages
| Stage | Meaning |
| --- | --- |
| New enquiry | Received, not yet actioned. Default. |
| Awaiting details | We asked the client for more information. |
| Proposal sent | A proposal or quote has gone to the client. |
| Follow-up due | A chase or follow-up is needed. Set by the owner; it is not automatic. |
| Won | The owner marked it won. **A label only: no booking is created or confirmed.** |
| Lost | Closed without a booking. |

Priority is `low`, `normal` (default), `high` or `urgent`. Brand is one of the three existing brands, or `Unassigned` when unknown (default). Won and Lost are excluded from the open summary counts and from the overdue filter. Only a person can set Won: the assistant API refuses it (403), and an enquiry created from a source message can never start as Won.

## Manual workflow
1. Open **Enquiries** and choose **New enquiry**. Only the client name is required. Leave date and venue blank when unknown; they are stored as empty, never invented.
2. Set stage, owner, priority, next action and its due date. Use **Set last contact to now** after speaking to the client.
3. Paste proposal and source links (http/https only).
4. Work the pipeline from the summary: check Overdue and Due today first.
5. When an event is agreed, mark the enquiry Won, then create the booking yourself in Bookings. Nothing is copied automatically.

## Controlled assistant API
Uses the existing AI client credentials in `ai_clients`; no new credentials. Read, create and update permissions are checked separately (`can_read`, `can_create`, `can_update`). Requests carry `Authorization: Bearer <token>`. Never put a token in the repository.

- `GET /api/ai/enquiries?q=&status=&brand=&owner=&overdue=1&due_today=1&limit=50&offset=0`
- `POST /api/ai/enquiries`
- `GET /api/ai/enquiries/:id`
- `PATCH /api/ai/enquiries/:id`

The browser equivalents are `/api/enquiries` and `/api/enquiries/:id`. They sit behind the same Cloudflare Access JWT check as bookings; an AI bearer token does not unlock them, and the AI routes do not accept Access identity.

Create (example data):
```json
POST /api/ai/enquiries
{ "client_name": "Local test client", "contact_email": "client@example.test",
  "brand": "Photobooths London", "service": "Self-service photo booth",
  "event_name": "Christmas party enquiry", "event_date": null,
  "brief": "Please quote for a self-service photo booth.",
  "source_mailbox": "inbox@example.test", "source_conversation_id": "thread-1", "source_message_id": "message-1" }
```
Response `201`:
```json
{ "id": "…", "reference": "ENQ-2026-1A2B3C", "client_name": "Local test client", "brand": "Photobooths London",
  "status": "New enquiry", "priority": "normal", "event_date": null, "venue": null, "version": 1, "…": "…" }
```
The private `write_token` is never returned. Creating again with the same source returns `200` and the existing record unchanged.

Update (send the latest `version` plus only the fields to change):
```json
PATCH /api/ai/enquiries/ID
{ "version": 1, "status": "Awaiting details", "next_action": "Ask for venue and guest numbers", "next_action_due": "2026-11-05" }
```
Returns the updated enquiry with `version: 2`. Missing or non-integer `version` gives `428`. A stale version gives `409` with the current `version`: read the enquiry again and reapply only your intended change. Invalid values give `400`. Unknown or read-only fields (`id`, `reference`, `source_*`, `version` as data, timestamps) are rejected. Invalid JSON gives `400`.

List response:
```json
{ "items": [ … ], "count": 50, "total": 123, "limit": 50, "offset": 0, "has_more": true,
  "summary": { "new": 4, "due_today": 1, "overdue": 2, "awaiting": 6, "open": 20 } }
```
`count` is this page; `total` is the number of matches across all pages; `summary` ignores filters and paging.

Validation: names and text have length limits; dates must be real `YYYY-MM-DD` dates; `last_contact_at` is an ISO date-time (stored as UTC); emails must look valid; `guest_count` is a whole number ≥ 0 or null; URLs must be `http(s)` without embedded credentials.

## Source de-duplication
When `source_mailbox` is supplied with a conversation or message ID:
- the key is mailbox + conversation, or mailbox + message when there is no conversation (mailbox compared case-insensitively);
- creating again returns the existing enquiry and never resets its status, owner, notes, deadlines or proposal;
- each message ID is linked once in `enquiry_messages` (unique per mailbox and message); a further message in a known conversation is linked, and the enquiry is unchanged;
- the same email address in a different conversation is a separate enquiry;
- concurrent creates for one source produce one record. Enquiry, message link and audit are saved in one D1 batch, so a failure leaves nothing half-saved.
Enquiries created by hand with no source are never de-duplicated.

## Applying the database change
Apply `migrations/0004_enquiries.sql` through the **owner's normal deployment process** (D1 console or Wrangler as the owner), after taking a backup. It creates three new tables (`enquiries`, `enquiry_messages`, `enquiry_audit`) and indexes with `IF NOT EXISTS`, and does not alter or delete any existing data. The assistant must never be given production D1 credentials.

Alternatively the existing Access-protected `/api/setup` route now also creates the same tables idempotently. Use either the migration or `/api/setup`, not both as separate steps; a test keeps the two definitions identical. Deploy code and migration together, because the new pages call tables that must exist.

## Inbox ingestion (prepared, not active)
The host scripts `scripts/enquiry_intake.py` and `scripts/enquiry_connector.ps1` reuse the existing Hermes Outlook integration and encrypted CRM identity on the Windows PA host. No new credentials are created and no credentials belong in this repository. Only the verified `info@quirky-hire.co.uk` inbox is covered; do not claim that separate Photobooths London or BXP mailboxes are connected.

Read-only preview (does not change email or CRM records):
```bash
python scripts/enquiry_intake.py
python tests/test_enquiry_intake.py
```
The parser recognises structured website forms and conservative new-enquiry wording. Marketing, ordinary replies and automatic replies are skipped. Unrecognised formats can be missed and need manual review. Client content is stored as data; it cannot change permissions, mark a lead Won, send a response or confirm a booking. Unknown event dates stay null and phone numbers keep leading zeroes. Potential leads are created as New enquiry with a review action, not treated as validated bookings. No client response is sent.

After deploying the enquiry endpoints/migration and verifying access, run `python scripts/enquiry_intake.py --ingest` explicitly on the PA host. The first ingestion run records a current-time baseline without importing history; later runs collect new messages and POST only to `/api/ai/enquiries`, then read back each exact saved record. A source key makes a retry idempotent. Failures stop without advancing the checkpoint or opening an interactive Microsoft sign-in. Large backlogs stop for controlled backfill rather than silently dropping data. Runtime state under `scripts/state/` is gitignored and must not be committed or included in a public release.

Scheduling remains disabled until live endpoint verification succeeds. A Hermes no-agent script schedule can then run the ingestion command and deliver newly saved lead notices to Ryan's configured Telegram channel. Confirm the actual job ID, cadence and delivery target before saying monitoring is active. The Windows machine must be awake and online. A successful preview is not proof of live CRM capture.

## Release and test commands
```
node --test tests/enquiries.test.mjs      # initial vertical slice
npm test                                   # all tests (in-memory SQLite behind a transactional D1-style adapter)
npm run build
```
See `TDD-EVIDENCE.md` for the recorded red/green runs. Tests cover create/read/list/update, unknown dates, validation, pagination, source duplicates, concurrent writers, version conflicts, audit rollback, booking preservation, route authentication and permissions, Access middleware and setup parity. Browser behaviour has no automated browser tests; check it manually after deployment.

## Limitations
- Inbox ingestion code is prepared but has not been activated against production; reminders and automatic stage changes are not implemented.
- `Follow-up due` is a manual stage; due dates are flagged in the UI but nothing moves an enquiry automatically.
- Editing is whole-record: a conflict on any field requires a reload even if you changed a different field (your edits are kept).
- Source fields are set at creation and cannot be edited afterwards.
- Pipeline columns show the enquiries loaded so far (50 per page, with Load more).
