import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Plus, Search } from 'lucide-react'
import { BRANDS, PRIORITIES, STAGES, buildPatch, dueState, londonToday, rebaseForm, safeHttpUrl, toForm } from './enquiryLogic'
import type { Enquiry, EnquiryForm, Field } from './enquiryLogic'
import './enquiries.css'

type Summary = { new: number; due_today: number; overdue: number; awaiting: number; open: number }
type Page = { items: Enquiry[]; total: number; has_more: boolean; summary: Summary }
type Wrap = (content: React.ReactNode) => React.ReactNode

const fmtDate = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null
const fmtWhen = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
const label = (k: string) => k.replaceAll('_', ' ')

function Link({ href, go, children, className }: { href: string; go: (p: string) => void; children: React.ReactNode; className?: string }) {
  return <a className={className} href={href} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(href) }}>{children}</a>
}

export function EnquiriesPage({ wrap }: { wrap: Wrap }) {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => { const f = () => setPath(location.pathname); addEventListener('popstate', f); return () => removeEventListener('popstate', f) }, [])
  const go = (p: string) => { history.pushState(null, '', p); setPath(p) }
  const id = path.match(/^\/enquiries\/([^/]+)\/?$/)?.[1]
  if (id) return <EnquiryEditor key={id} id={id === 'new' ? null : decodeURIComponent(id)} go={go} />
  return <>{wrap(<EnquiryList go={go} />)}</>
}

function EnquiryList({ go }: { go: (p: string) => void }) {
  const [filters, setFilters] = useState({ q: '', status: '', owner: '', brand: '', overdue: false })
  const [applied, setApplied] = useState(filters)
  const [layout, setLayout] = useState<'pipeline' | 'list'>('pipeline')
  const [data, setData] = useState<Page | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const seq = useRef(0)
  useEffect(() => { const t = setTimeout(() => setApplied(filters), 250); return () => clearTimeout(t) }, [filters])
  const load = useCallback(async (offset: number) => {
    const n = ++seq.current
    const params = new URLSearchParams({ limit: '50', offset: String(offset) })
    for (const k of ['q', 'status', 'owner', 'brand'] as const) if (applied[k]) params.set(k, applied[k])
    if (applied.overdue) params.set('overdue', '1')
    try {
      const r = await fetch('/api/enquiries?' + params)
      const body = await r.json().catch(() => ({}))
      if (n !== seq.current) return // a newer request superseded this one
      if (!r.ok) throw new Error(body.error || 'Enquiries could not be loaded.')
      setData(prev => offset && prev ? { ...body, items: [...prev.items, ...body.items] } : body)
      setState('ready'); setError('')
    } catch (e) {
      if (n !== seq.current) return
      setError(e instanceof Error ? e.message : 'Enquiries could not be loaded.'); setState('error')
    }
  }, [applied])
  useEffect(() => { setState('loading'); void load(0) }, [load])
  const more = async () => { if (loadingMore || !data) return; setLoadingMore(true); try { await load(data.items.length) } finally { setLoadingMore(false) } }
  const today = londonToday(), s = data?.summary, items = data?.items || []
  const set = (patch: Partial<typeof filters>) => setFilters(f => ({ ...f, ...patch }))
  const owners = [...new Set(items.map(i => i.owner).filter(Boolean))] as string[]
  return <>
    <header><div><h1>Enquiries</h1><p>New leads before they become bookings. Marking an enquiry Won does not create a booking.</p></div>
      <Link href="/enquiries/new" go={go} className="primary"><Plus size={18} />New enquiry</Link></header>
    <section className="stats" aria-label="Enquiry summary">
      <Stat label="New" value={s?.new} /><Stat label="Due today" value={s?.due_today} /><Stat label="Overdue" value={s?.overdue} danger /><Stat label="Awaiting reply" value={s?.awaiting} />
    </section>
    <p className="eqNote">Summary counts every open enquiry (not Won or Lost), whatever the filters. Awaiting reply = Awaiting details or Proposal sent. Dates use London time ({fmtDate(today)}).</p>
    <section className="panel">
      <div className="panelHead eqHead"><div><h2>Enquiry pipeline</h2><p>{state === 'ready' ? `Showing ${items.length} of ${data?.total} matching enquiries` : 'Search by client, company, event, service, email or reference.'}</p></div>
        <div className="eqLayout" role="group" aria-label="Layout"><button aria-pressed={layout === 'pipeline'} onClick={() => setLayout('pipeline')}>Pipeline</button><button aria-pressed={layout === 'list'} onClick={() => setLayout('list')}>List</button></div></div>
      <div className="eqFilters">
        <label className="search"><Search size={17} /><span className="srOnly">Search enquiries</span><input value={filters.q} onChange={e => set({ q: e.target.value })} placeholder="Search enquiries…" /></label>
        <label>Stage<select value={filters.status} onChange={e => set({ status: e.target.value })}><option value="">All stages</option>{STAGES.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Brand<select value={filters.brand} onChange={e => set({ brand: e.target.value })}><option value="">All brands</option>{BRANDS.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Owner<input list="eqOwners" value={filters.owner} onChange={e => set({ owner: e.target.value })} placeholder="Any owner" /><datalist id="eqOwners">{owners.map(o => <option key={o} value={o} />)}</datalist></label>
        <label className="eqCheck"><input type="checkbox" checked={filters.overdue} onChange={e => set({ overdue: e.target.checked })} />Overdue only</label>
      </div>
      {state === 'loading' && <p className="empty" role="status">Loading enquiries…</p>}
      {state === 'error' && <div className="eqError" role="alert"><p>{error}</p><button onClick={() => { setState('loading'); void load(0) }}>Try again</button></div>}
      {state === 'ready' && items.length === 0 && <p className="empty">{data?.total === 0 && !applied.q && !applied.status && !applied.owner && !applied.brand && !applied.overdue ? 'No enquiries recorded yet. Use New enquiry to capture one.' : 'No enquiries match these filters.'}</p>}
      {state === 'ready' && items.length > 0 && (layout === 'pipeline'
        ? <div className="pipeline">{STAGES.map(stage => { const col = items.filter(i => i.status === stage); return <section key={stage} className="stage" aria-label={stage}><h3>{stage}<span>{col.length}</span></h3>{col.length === 0 && <p className="eqNone">None loaded</p>}{col.map(i => <Card key={i.id} e={i} today={today} go={go} />)}</section> })}</div>
        : <div className="eqList">{items.map(i => <Card key={i.id} e={i} today={today} go={go} row />)}</div>)}
      {state === 'ready' && data?.has_more && <div className="eqMore"><button disabled={loadingMore} onClick={more}>{loadingMore ? 'Loading…' : `Load more (${data.total - items.length} not shown)`}</button></div>}
    </section>
  </>
}

function Stat({ label, value, danger = false }: { label: string; value?: number; danger?: boolean }) {
  return <div className={`stat ${danger ? 'danger' : ''}`}><small>{label}</small><strong>{value ?? '—'}</strong></div>
}

function Card({ e, today, go, row = false }: { e: Enquiry; today: string; go: (p: string) => void; row?: boolean }) {
  const due = dueState(e, today)
  return <Link href={`/enquiries/${encodeURIComponent(e.id)}`} go={go} className={`eqCard ${row ? 'row' : ''}`}>
    <strong>{e.event_name || e.client_name}</strong>
    <small>{e.reference} · {e.client_name}{e.company ? ` · ${e.company}` : ''}</small>
    <span className="eqMeta"><em className={`pri ${e.priority}`}>{e.priority}</em><em>{e.brand}</em>{row && <em>{e.status}</em>}{e.service && <em>{e.service}</em>}</span>
    <small>Event: {fmtDate(e.event_date) || 'date to be confirmed'} · Owner: {e.owner || 'unassigned'}</small>
    <small>Last contact: {fmtWhen(e.last_contact_at) || 'none recorded'}</small>
    <small className={`due ${due}`}>{e.next_action || 'No next action set'}{e.next_action_due ? ` · due ${fmtDate(e.next_action_due)}${due === 'overdue' ? ' (overdue)' : due === 'today' ? ' (today)' : ''}` : ''}</small>
  </Link>
}

function TextField({ f, name, form, set, conflicts, type = 'text', max, hint, required }: { f: string; name: Field; form: EnquiryForm; set: (k: Field, v: string) => void; conflicts: Field[]; type?: string; max?: number; hint?: string; required?: boolean }) {
  return <label htmlFor={'eq-' + name}>{f}{required && ' *'}{conflicts.includes(name) && <b className="eqWarn"> ⚠ also changed by someone else</b>}
    <input id={'eq-' + name} type={type} value={form[name]} maxLength={max} required={required} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 1 : undefined} onChange={e => set(name, e.target.value)} />{hint && <small>{hint}</small>}</label>
}
function SelectField({ f, name, form, set, options, conflicts }: { f: string; name: Field; form: EnquiryForm; set: (k: Field, v: string) => void; options: string[]; conflicts: Field[] }) {
  return <label htmlFor={'eq-' + name}>{f}{conflicts.includes(name) && <b className="eqWarn"> ⚠ also changed by someone else</b>}
    <select id={'eq-' + name} value={form[name]} onChange={e => set(name, e.target.value)}>{options.map(o => <option key={o}>{o}</option>)}</select></label>
}

function EnquiryEditor({ id, go }: { id: string | null; go: (p: string) => void }) {
  const [base, setBase] = useState<Enquiry | null>(null)
  const [form, setForm] = useState<EnquiryForm>(toForm(null))
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>(id ? 'loading' : 'ready')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [conflicts, setConflicts] = useState<Field[]>([])
  const inFlight = useRef(false)
  const load = useCallback(async () => {
    if (!id) return
    setState('loading')
    try {
      const r = await fetch(`/api/enquiries/${encodeURIComponent(id)}`)
      if (r.status === 404) return setState('missing')
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'The enquiry could not be loaded.')
      setBase(body); setForm(toForm(body)); setState('ready')
    } catch (e) { setError(e instanceof Error ? e.message : 'The enquiry could not be loaded.'); setState('error') }
  }, [id])
  useEffect(() => { void load() }, [load])
  const patch = buildPatch(base, form), dirty = Object.keys(patch).length > 0
  useEffect(() => { if (!dirty) return; const f = (e: BeforeUnloadEvent) => e.preventDefault(); addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f) }, [dirty])
  const set = (k: Field, v: string) => { setForm(f => ({ ...f, [k]: v })); setNotice('') }
  const props = { form, set, conflicts }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current || conflict) return // duplicate-submit protection; a conflict must be resolved first
    if (!form.client_name.trim()) return setError('Client name is required.')
    inFlight.current = true; setSaving(true); setError(''); setNotice('')
    try {
      const r = await fetch(id ? `/api/enquiries/${encodeURIComponent(id)}` : '/api/enquiries', {
        method: id ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(id && base ? { version: base.version, ...patch } : patch),
      })
      const body = await r.json().catch(() => ({}))
      if (r.status === 409 && id) { setConflict(true); return setError('Someone else updated this enquiry. Your changes have not been saved and are still in the form.') }
      if (!r.ok) throw new Error(body.error || 'Save failed. Your changes are still in the form.')
      if (!id) return go(`/enquiries/${encodeURIComponent(body.id)}`)
      setBase(body); setForm(toForm(body)); setConflicts([]); setNotice('Saved.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed. Check your connection; your changes are still in the form.') }
    finally { inFlight.current = false; setSaving(false) }
  }
  // Reload after a conflict: keep unsaved edits on top of the latest server copy; the user saves again deliberately.
  const reload = async (keepEdits: boolean) => {
    if (!id || !base) return
    try {
      const r = await fetch(`/api/enquiries/${encodeURIComponent(id)}`)
      const latest = await r.json()
      if (!r.ok) throw new Error(latest.error || 'Could not reload.')
      if (keepEdits) { const rb = rebaseForm(base, form, latest); setForm(rb.form); setConflicts(rb.conflicts) } else { setForm(toForm(latest)); setConflicts([]) }
      setBase(latest); setConflict(false)
      setError(''); setNotice(keepEdits ? `Reloaded version ${latest.version}. Your unsaved edits are kept; review them, then save.` : `Reloaded version ${latest.version}. Your edits were discarded.`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not reload.') }
  }
  const leave = () => { if (inFlight.current) return; if (!dirty || confirm('Leave without saving your changes?')) go('/enquiries') }
  const links = (['proposal_url', 'source_url'] as const).map(k => [k, safeHttpUrl(form[k])] as const)

  if (state === 'loading') return <div className="detail"><p className="empty" role="status">Loading enquiry…</p></div>
  if (state === 'missing') return <div className="detail"><div className="detailBody"><p role="alert">This enquiry could not be found.</p><button onClick={() => go('/enquiries')}>Back to enquiries</button></div></div>
  if (state === 'error') return <div className="detail"><div className="detailBody"><div className="eqError" role="alert"><p>{error}</p><button onClick={() => void load()}>Try again</button> <button onClick={() => go('/enquiries')}>Back to enquiries</button></div></div></div>
  return <div className="detail">
    <div className="detailTop"><button disabled={saving} onClick={leave}><ChevronLeft size={18} />Enquiries</button>
      {id && <button onClick={() => navigator.clipboard.writeText(`${location.origin}/enquiries/${id}`)}>Copy enquiry link</button>}</div>
    <form className="detailBody" onSubmit={save} aria-busy={saving}>
      <fieldset className="eqFields" disabled={saving}>
      <div className="title"><div><small>{base ? `${base.reference} · ${base.brand}` : 'NEW ENQUIRY'}</small><h1>{form.event_name || form.client_name || 'New enquiry'}</h1>
        <p>{base ? `Version ${base.version} · created ${fmtWhen(base.created_at?.replace(' ', 'T') + 'Z') || ''}` : 'Capture what you know. Date and venue can stay blank until confirmed.'}</p></div><em>{form.status}</em></div>
      {error && <div className="eqError" role="alert"><p>{error}</p>{conflict && <div className="eqConflict"><button type="button" onClick={() => void reload(true)}>Reload latest and keep my edits</button><button type="button" onClick={() => void reload(false)}>Reload latest and discard my edits</button></div>}</div>}
      {notice && <p className="eqOk" role="status">{notice}</p>}
      {saving && <p role="status">Saving…</p>}
      <div className="detailGrid">
        <section className="panel card"><h2>Client and event</h2>
          <div className="form">
            <TextField f="Client name" name="client_name" max={200} required {...props} /><TextField f="Company" name="company" max={200} {...props} />
            <TextField f="Contact email" name="contact_email" type="email" max={254} {...props} /><TextField f="Contact phone" name="contact_phone" type="tel" max={50} {...props} />
            <SelectField f="Brand" name="brand" options={BRANDS} {...props} /><TextField f="Service" name="service" max={200} {...props} />
            <TextField f="Event name" name="event_name" max={200} {...props} /><TextField f="Event date" name="event_date" type="date" hint="Leave blank if unknown." {...props} />
            <TextField f="Venue" name="venue" max={300} hint="Leave blank if unknown." {...props} /><TextField f="Guest count" name="guest_count" type="number" {...props} />
            <TextField f="Budget" name="budget" max={100} hint="Free text, for example “around £1,500”." {...props} />
          </div>
          <label htmlFor="eq-brief">Brief{conflicts.includes('brief') && <b className="eqWarn"> ⚠ also changed by someone else</b>}<textarea id="eq-brief" value={form.brief} maxLength={5000} onChange={e => set('brief', e.target.value)} placeholder="What the client asked for, key requirements, notes…" /></label>
        </section>
        <section className="panel card"><h2>Follow-up</h2>
          <div className="form">
            <SelectField f="Stage" name="status" options={STAGES} {...props} /><SelectField f="Priority" name="priority" options={PRIORITIES} {...props} />
            <TextField f="Owner" name="owner" max={100} {...props} /><TextField f="Next action due" name="next_action_due" type="date" {...props} />
            <TextField f="Next action" name="next_action" max={500} {...props} />
            <TextField f="Last contact" name="last_contact_at" type="datetime-local" {...props} />
          </div>
          <button type="button" className="eqSecondary" onClick={() => { const d = new Date(); d.setSeconds(0, 0); set('last_contact_at', new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)) }}>Set last contact to now</button>
          <p className="eqNote">Won and Lost are labels only. Won does not create or confirm a booking; create the booking separately once the event is agreed.</p>
          <h2 className="eqSub">Links</h2>
          <div className="form">
            <TextField f="Proposal link" name="proposal_url" type="url" max={2000} hint="http(s) only" {...props} /><TextField f="Source link" name="source_url" type="url" max={2000} hint="For example a link to the original message" {...props} />
          </div>
          <p className="eqLinks">{links.map(([k, href]) => href && <a key={k} href={href} target="_blank" rel="noopener noreferrer">Open {label(k).replace(' url', '')} link</a>)}</p>
          {base?.source_mailbox && <p className="eqNote">Linked source: {base.source_mailbox}{base.source_conversation_id ? ` · conversation ${base.source_conversation_id}` : ''}. Re-saving the same message never overwrites this record.</p>}
        </section>
      </div>
      <div className="actions"><button type="button" onClick={leave}>Cancel</button><button className="primary" type="submit" disabled={saving || conflict || (!!id && !dirty)}>{saving ? 'Saving…' : id ? (dirty ? 'Save changes' : 'No changes to save') : 'Create enquiry'}</button></div>
      </fieldset>
    </form>
  </div>
}
