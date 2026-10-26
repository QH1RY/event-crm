# Personal PA setup

This directory contains the owner's Hermes behaviour profile and a restricted CRM command wrapper. It does not contain credentials.

## Host layout
Use the official Hermes Windows installer and keep the Hermes data directory separate from its source checkout. Copy SOUL.md into the Hermes data directory after installation; preserve an existing profile if one exists.
Run hermes doctor and hermes config check before connecting services.

## AI accounts
Use hermes model to choose a supported provider and sign in directly. Start with the owner's existing ChatGPT/Codex subscription if eligible. Claude access must be configured separately using a supported account or API route. Never copy or print tokens from another application's files.
Configure image generation separately: a working language model does not prove the image tool works.

## CRM
Run crm.ps1 with PowerShell 7. Supported actions are Health, List, Get, Create, Update, CreateTask and UpdateTask.
Set CRM_BASE_URL, CRM_AI_TOKEN, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the host's secret configuration, not in source control.
Creating these credentials and granting Hermes access require the owner's explicit authorisation at the point of configuration.
Use a distinct Hermes AI client with read/create/update only. Cloudflare Access should use a service-auth policy restricted to the specific Hermes service token.
No archive or delete action is exposed by this wrapper.
A Health request alone does not prove the authenticated booking API works. Verify a booking read, then use a disposable record to test an individual task update and a stale-version conflict.

Examples:
```powershell
./pa/crm.ps1 -Action Get -BookingId BOOKING_ID
./pa/crm.ps1 -Action CreateTask -BookingId BOOKING_ID -InputFile ./task.json
```
Task JSON: { "version": 1, "title": "Prepare proposal", "owner": "Claude", "due_date": "2026-11-01" }

## Outlook
The existing scripts/outlook.ps1 provides calendar checks, inbox summaries, draft creation and explicit booking sync.
Use the same Windows account that completed Outlook verification. The SDK owns the encrypted Microsoft credential cache.
A new PowerShell process must reconnect to the cached Microsoft identity before executing Outlook actions; Get-MgContext alone is not a persistent-credential check.
Verify the account matches info@quirky-hire.co.uk. Do not create another sign-in loop if unattended authentication fails.

## Reminders and task tracking
Configure a delivery channel before promising scheduled reminders.
Use Europe/London for scheduling. Obtain the preferred morning briefing time before enabling recurring notifications.
Windows must be awake and online for local scheduled jobs.
Booking tasks belong in the CRM; personal tasks must have their own durable register.
Do not mark this setup live until the model, authenticated CRM read, Outlook action and reminder delivery have each been verified.
