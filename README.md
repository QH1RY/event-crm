# Event CRM

Private event-booking operations CRM for Quirky Hire, Photobooths London and Brand Experience Partner.

## Stack
- React + Vite
- Cloudflare Pages
- Cloudflare Pages Functions
- Cloudflare D1
- Cloudflare Access recommended for authentication

## Features in MVP
- Booking register and search
- Permanent booking URL for pasting into Outlook calendar notes
- Event timings and venue details
- Operational notes
- Per-booking delivery checklist
- Due dates, owners, progress and overdue visibility
- New booking workflow
- Brand/service support

## Local development
```bash
npm install
npm run dev
```

## Cloudflare deployment
1. Create a Cloudflare Pages project linked to this GitHub repository.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Create a D1 database, for example `event-crm-db`.
5. Run both SQL files in `migrations/` against the D1 database, in numerical order.
6. In the Pages project add a D1 binding called `DB` pointing to that database for Preview and Production.
7. Redeploy.
8. Protect the site with Cloudflare Access so only authorised team email addresses can open it.
9. Add a custom domain such as `bookings.quirky-hire.co.uk` or `crm.quirky-hire.co.uk`.

## Outlook workflow
Open a booking and click **Copy Outlook link**. Paste that URL into the corresponding Outlook calendar event notes. The URL remains the operational source of truth for that event.

## AI access for ChatGPT and Claude
The CRM includes a controlled AI API under `/api/ai`. It is designed so ChatGPT and Claude can read and update the same Cloudflare D1 data without receiving direct database credentials.

### Security model
- Each AI assistant receives its own bearer token.
- Only the SHA-256 hash of the token is stored in D1.
- Permissions are separate for read, create, update, archive and permanent delete.
- Permanent delete is disabled by design. Archive is used instead.
- Every AI create/update/archive action is written to `audit_log`.

### AI endpoints
- `GET /api/ai/health`
- `GET /api/ai/bookings?q=&from=&to=`
- `POST /api/ai/bookings`
- `GET /api/ai/bookings/:id`
- `PATCH /api/ai/bookings/:id`
- `DELETE /api/ai/bookings/:id` archives only and requires archive permission
- `GET /api/ai/audit?booking_id=&limit=`

### Recommended AI permissions
- ChatGPT: read=1, create=1, update=1, archive=0, delete=0
- Claude: read=1, create=1, update=1, archive=0, delete=0

Never commit raw AI tokens to GitHub. Store them only in the relevant connector/MCP secret configuration.
