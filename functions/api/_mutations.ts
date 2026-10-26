// D1 batch is transactional. Every write is guarded by a successful version claim.
export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export async function readBooking(db: D1Database, id: string, includeArchived = false) {
  const b = await db.prepare('SELECT * FROM bookings WHERE id=?' + (includeArchived ? '' : ' AND archived_at IS NULL')).bind(id).first<any>()
  if (!b) return null
  delete b.write_token
  const { results } = await db.prepare('SELECT * FROM checklist_items WHERE booking_id=? ORDER BY sort_order,id').bind(id).all<any>()
  return { ...b, checklist: results.map(i => ({ ...i, completed: !!i.completed })) }
}

const fields = ['client_name','company','event_name','brand','service','status','event_date','event_start','event_end','access_time','setup_ready_by','collection_time','venue','venue_address','contact_phone','contact_email','notes','outlook_event_id','outlook_event_url']
const taskFields = ['title','completed','due_date','owner','sort_order']
const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const cleanTask = (i: any) => i && typeof i.title === 'string' && i.title.trim() &&
  (!has(i,'completed') || typeof i.completed === 'boolean') &&
  (!has(i,'due_date') || i.due_date === null || (typeof i.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.due_date))) &&
  (!has(i,'owner') || i.owner === null || typeof i.owner === 'string') &&
  (!has(i,'sort_order') || Number.isSafeInteger(i.sort_order))

export async function mutateBooking(db: D1Database, id: string, p: any,
  actor: { name: string; type: 'ai' | 'user' },
  task?: { action: 'create' | 'update'; id?: string },
  lifecycle?: 'archive' | 'restore') {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return json({error:'Expected a JSON object'},400)
  if (!Number.isSafeInteger(p.version) || p.version < 1) return json({error:'Read the booking first and supply its integer version'},428)
  const before = await readBooking(db,id,!!lifecycle)
  if (!before) return json({error:'Booking not found'},404)
  if (before.version !== p.version) return json({error:'This booking changed. Read it again and reapply only your intended change.',version:before.version},409)
  if (before.archived_at && lifecycle !== 'restore') return json({error:'Restore the booking before changing it'},409)
  const token = crypto.randomUUID()
  const sets: string[] = [], values: any[] = []
  if (!task && !lifecycle) {
    for (const k of fields) if (has(p,k)) {
      if (p[k] !== null && typeof p[k] !== 'string') return json({error:k+' must be text or null'},400)
      if (['client_name','event_name','brand','service','status','event_date'].includes(k) && !p[k]?.trim()) return json({error:k+' cannot be empty'},400)
      sets.push(k+'=?'); values.push(p[k])
    }
  }
  const statements: D1PreparedStatement[] = []
  const guard = 'EXISTS (SELECT 1 FROM bookings WHERE id=? AND write_token=?)'
  const addTask = (i: any, n: number) => db.prepare(
    'INSERT INTO checklist_items (id,booking_id,title,completed,due_date,owner,sort_order) SELECT ?,?,?,?,?,?,? WHERE '+guard
  ).bind(i.id || crypto.randomUUID(),id,i.title.trim(),i.completed?1:0,i.due_date||null,i.owner||null,i.sort_order??n,id,token)
  if (task) {
    if (task.action === 'create') {
      if (!cleanTask(p)) return json({error:'A task title and valid task fields are required'},400)
      statements.push(addTask({...p,id:crypto.randomUUID()},before.checklist.length))
    } else {
      const old = before.checklist.find((i: any) => i.id === task.id)
      if (!old) return json({error:'Task not found in this booking'},404)
      if (!cleanTask({...old,...p})) return json({error:'Invalid task fields'},400)
      const keys = taskFields.filter(k => has(p,k))
      if (!keys.length) return json({error:'No task changes supplied'},400)
      statements.push(db.prepare('UPDATE checklist_items SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=? AND booking_id=? AND '+guard)
        .bind(...keys.map(k=>k==='completed'?(p[k]?1:0):p[k]),task.id,id,id,token))
    }
  } else if (has(p,'checklist')) {
    if (!Array.isArray(p.checklist) || p.checklist.some((i: any)=>!cleanTask(i))) return json({error:'Invalid checklist'},400)
    const ids = p.checklist.filter((i: any)=>i.id).map((i: any)=>i.id)
    if (ids.some((i: any)=>typeof i!=='string') || new Set(ids).size!==ids.length) return json({error:'Task IDs must be unique strings'},400)
    // Legacy full replacement is allowed only with the exact booking version.
    statements.push(db.prepare('DELETE FROM checklist_items WHERE booking_id=? AND '+guard).bind(id,id,token))
    p.checklist.forEach((i: any,n: number)=>statements.push(addTask(i,n)))
  }
  if (lifecycle) sets.push(lifecycle==='archive'?'archived_at=CURRENT_TIMESTAMP':'archived_at=NULL')
  if (!sets.length && !statements.length) return json({error:'No supported changes supplied'},400)
  const claim = db.prepare('UPDATE bookings SET '+[...sets,'version=version+1','write_token=?','updated_at=CURRENT_TIMESTAMP'].join(',')+' WHERE id=? AND version=?'+(lifecycle?'':' AND archived_at IS NULL'))
    .bind(...values,token,id,p.version)
  const action = lifecycle || (task ? 'task.'+task.action : 'booking.update')
  // Audit and data writes commit together; a failed audit rolls back the change.
  const audit = db.prepare('INSERT INTO audit_log (id,booking_id,actor_type,actor_name,action,summary,before_json,after_json) SELECT ?,?,?,?,?,?,?,? WHERE '+guard)
    .bind(crypto.randomUUID(),id,actor.type,actor.name,action,'Version '+p.version+' to '+(p.version+1),JSON.stringify(before),JSON.stringify({patch:p,task,lifecycle,version:p.version+1}),id,token)
  const result = await db.batch([claim,...statements,audit])
  if (!result[0].meta.changes) return json({error:'Another writer saved first. Read the booking again before retrying.'},409)
  return json(await readBooking(db,id,true),task?.action==='create'?201:200)
}
