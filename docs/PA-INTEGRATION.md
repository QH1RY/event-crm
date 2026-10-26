# PA integration and activation

## Current state
This change prepares the CRM and an Outlook connector. It does not connect a mailbox, install Hermes, schedule reminders, or deploy production.

## Deploy the CRM changes
1. Back up the production D1 database.
2. Apply migrations/0003_concurrent_updates.sql once, after 0001 and 0002, using the Cloudflare D1 console or Wrangler. Alternatively the existing /api/setup route now adds missing columns idempotently; do not run both approaches. Keep setup behind Cloudflare Access.
3. Deploy this branch through Cloudflare Pages. A migration alone is backward compatible, but older deployed code still has unguarded writers: update server and UI together and reload old browser tabs.
4. Require Cloudflare Access on the CRM and ordinary /api/bookings and /api/setup routes. Set Pages environment variables ACCESS_TEAM_DOMAIN (your-team.cloudflareaccess.com) and ACCESS_AUD (the Access application audience). The browser API verifies Cloudflare's signed JWT and fails closed until configured. No browser bookings or setup access is allowed without a valid Access assertion. AI bearer authentication does not protect the separate browser routes.
5. Configure a Cloudflare Access service token for the PA host if Access protects the AI routes too. Store CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the host's secret configuration.
6. Create a separate AI client for Hermes (read/create/update enabled, archive/delete disabled). Generate a cryptographically random token on the host, store only its SHA-256 hash in ai_clients, and store the raw token in the host's secret configuration. Never put tokens in GitHub, an email or a chat.
7. Verify GET /api/ai/health, then authenticated GET /api/ai/bookings using each assistant's own token. Check unauthenticated requests are rejected. A working health endpoint alone does not verify database access.
8. Use a disposable test booking: read it, update one task, then attempt another update with the old version. Expect 409. Check the other tasks and audit entry, then archive the test booking using an authorised operator.

## CRM contract
Every update/archive/restore supplies the integer booking version from the latest GET.
- PATCH /api/ai/bookings/:id: { "version": 1, "notes": "Updated operational note" }
- POST /api/ai/bookings/:id/tasks: { "version": 1, "title": "Prepare proposal", "owner": "Claude", "due_date": "2026-11-01" }
- PATCH /api/ai/bookings/:id/tasks/:taskId: { "version": 2, "completed": true }
- Browser equivalents use /api/bookings instead of /api/ai/bookings.
Successful mutations return the current booking and its new version. Missing versions return 428; stale versions return 409. On conflict, re-read and reapply the intended field/task change. Never retry a stale full snapshot blindly.
The guard is booking-wide: even edits to different tasks can conflict. This deliberately favours correctness and a simple client contract. Data and audit writes commit in one D1 batch.
Legacy full-checklist replacement requires a version too. Normal UI task changes use individual task endpoints.

## Outlook on the eventual PA host
The connector runs on the host, not inside the public CRM browser. It uses Microsoft's Graph PowerShell authentication SDK and delegated access to the signed-in mailbox. Microsoft manages the credential cache; no mailbox password is stored by this repository.

Install PowerShell 7 and the official Microsoft.Graph.Authentication module:
```powershell
Install-Module Microsoft.Graph.Authentication -Scope CurrentUser -Repository PSGallery
$env:OUTLOOK_ACCOUNT = 'your-mailbox@example.com'
./scripts/outlook.ps1 -Action Connect
./scripts/outlook.ps1 -Action Status
```
Sign in yourself and review Microsoft's permission request: User.Read, Calendars.ReadWrite and Mail.ReadWrite. Mail.Send is not requested. Mail.ReadWrite allows more than drafts; this script exposes only inbox listing and draft creation. If the tenant blocks the default Microsoft Graph PowerShell app, its administrator must approve it or provide a dedicated public-client app via OUTLOOK_CLIENT_ID and OUTLOOK_TENANT_ID. Personal accounts and shared mailboxes need validation on the intended account; this initial connector operates on /me (the signed-in user's own mailbox/calendar).

Configure CRM_BASE_URL (HTTPS origin) and CRM_AI_TOKEN as host secrets, plus Cloudflare service-token secrets if needed. Do not paste credentials into the repository.

Examples:
```powershell
./scripts/outlook.ps1 -Action Calendar -From '2026-11-27T00:00:00Z' -To '2026-11-28T00:00:00Z'
./scripts/outlook.ps1 -Action Inbox
./scripts/outlook.ps1 -Action Draft -InputFile ./draft.json
./scripts/outlook.ps1 -Action SyncBooking -BookingId BOOKING_ID
```
Draft JSON: { "to": ["client@example.com"], "subject": "Your proposal", "body": "Draft text for review." }
Verify recipient identity before preparing client correspondence. Draft creates an Outlook draft and never sends it.

SyncBooking is an explicit operation, not an automatic background job. It checks calendar conflicts and requires date/start/end in the CRM. It creates/updates one event with the CRM link and a 60-minute reminder, then stores the Outlook event ID/URL using the booking version. It does not invite attendees or confirm the booking. UK daylight saving is handled with GMT Standard Time; ambiguous or overnight times stop for review. Existing linked entries with attendees stop for review. Conflict checks are advisory; Outlook cannot atomically reserve a time against other calendar writers.

Graph and D1 cannot commit together. If Outlook succeeds but the CRM save fails, the connector returns the Outlook ID and requests reconciliation. Store that ID against the latest booking version before rerunning; do not blindly create another event. The Graph transaction ID also reduces duplicates after lost responses.
This is one-way, explicit CRM-to-calendar sync. Two-way changes, inbox-to-enquiry ingestion and scheduled PA reminders still require Hermes workflows. Unattended access depends on the host running and Microsoft's refresh/conditional-access policy; a revoked/expired session needs sign-in again.

## Verification
- Node 24+: node --test tests/*.test.mjs (in-memory SQLite with transactional D1 adapter).
- PowerShell: ./tests/outlook.test.ps1 (mock SDK and CRM, no real email/calendar access).
- npm run build and Pages Functions bundling in GitHub Actions.
- Live mailbox validation after sign-in: read a calendar window, read inbox subjects, create a test draft and sync a disposable booking. Inspect Outlook and CRM, then clean up the test items manually.

## Live baseline checked before deployment
On 26 October 2026, /api/ai/health returned 200 and the AI booking list returned 401 without credentials. The ordinary /api/bookings returned 200 without credentials; its response body was not read. This change adds signed Access verification for browser data/setup routes. Recheck those routes after deployment: no unsigned request should return booking data.
