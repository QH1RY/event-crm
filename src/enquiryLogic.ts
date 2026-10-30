// Pure enquiry helpers (no imports, no DOM) so they can be unit tested without a browser.
export const STAGES = ['New enquiry', 'Awaiting details', 'Proposal sent', 'Follow-up due', 'Won', 'Lost']
export const BRANDS = ['Quirky Hire', 'Photobooths London', 'Brand Experience Partner', 'Unassigned']
export const PRIORITIES = ['low', 'normal', 'high', 'urgent']

export type Enquiry = {
  id: string; reference: string; version: number; client_name: string; company: string | null; brand: string
  service: string | null; event_name: string | null; contact_email: string | null; contact_phone: string | null
  event_date: string | null; venue: string | null; guest_count: number | null; brief: string | null; budget: string | null
  status: string; priority: string; owner: string | null; next_action: string | null; next_action_due: string | null
  last_contact_at: string | null; proposal_url: string | null; source_url: string | null
  source_mailbox?: string | null; source_conversation_id?: string | null; source_message_id?: string | null
  created_at?: string; updated_at?: string
}
export const FIELDS = ['client_name', 'company', 'brand', 'service', 'event_name', 'contact_email', 'contact_phone', 'event_date', 'venue', 'guest_count',
  'brief', 'budget', 'status', 'priority', 'owner', 'next_action', 'next_action_due', 'last_contact_at', 'proposal_url', 'source_url'] as const
export type Field = typeof FIELDS[number]
export type EnquiryForm = Record<Field, string>

export const londonToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

const pad = (n: number) => String(n).padStart(2, '0')
export const isoToLocalInput = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}
export const localInputToIso = (value: string) => {
  if (!value) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export const toForm = (e?: Partial<Enquiry> | null): EnquiryForm => {
  const form = {} as EnquiryForm
  for (const k of FIELDS) {
    const v = e?.[k]
    form[k] = k === 'last_contact_at' ? isoToLocalInput(v as string | null) : v === null || v === undefined ? '' : String(v)
  }
  if (!e) { form.brand = 'Unassigned'; form.status = 'New enquiry'; form.priority = 'normal' }
  return form
}

const convert = (k: Field, v: string) => {
  const t = v.trim()
  if (k === 'brand' || k === 'status' || k === 'priority') return t
  if (t === '') return null
  if (k === 'guest_count') return Number(t)
  if (k === 'last_contact_at') return localInputToIso(t)
  return t
}

// Only fields the user actually changed are sent, so a save never overwrites someone else's edits to other fields.
export const buildPatch = (base: Enquiry | null, form: EnquiryForm) => {
  const original = toForm(base), patch: Record<string, unknown> = {}
  for (const k of FIELDS) if (form[k] !== original[k]) patch[k] = convert(k, form[k])
  return patch
}

// After a version conflict: keep the user's unsaved edits, refresh everything else, and list fields both sides changed.
export const rebaseForm = (base: Enquiry, mine: EnquiryForm, latest: Enquiry) => {
  const was = toForm(base), now = toForm(latest), form = {} as EnquiryForm, conflicts: Field[] = []
  for (const k of FIELDS) {
    if (mine[k] !== was[k]) {
      form[k] = mine[k]
      if (now[k] !== was[k] && now[k] !== mine[k]) conflicts.push(k)
    } else form[k] = now[k]
  }
  return { form, conflicts }
}

export const dueState = (e: Pick<Enquiry, 'status' | 'next_action_due'>, today: string) => {
  if (e.status === 'Won' || e.status === 'Lost') return 'closed'
  if (!e.next_action_due) return 'none'
  return e.next_action_due < today ? 'overdue' : e.next_action_due === today ? 'today' : 'upcoming'
}

export const safeHttpUrl = (v?: string | null) => {
  if (!v) return null
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null } catch { return null }
}
