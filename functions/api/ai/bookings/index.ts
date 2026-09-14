import { audit, requireAIClient } from '../_auth'
interface Env { DB: D1Database }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})

export const onRequestGet: PagesFunction<Env> = async ({env,request}) => {
  const auth=await requireAIClient(env,request,'read'); if(auth.error)return auth.error
  const url=new URL(request.url); const q=(url.searchParams.get('q')||'').trim(); const from=url.searchParams.get('from'); const to=url.searchParams.get('to')
  const where=['archived_at IS NULL']; const binds:any[]=[]
  if(q){where.push('(reference LIKE ? OR client_name LIKE ? OR company LIKE ? OR event_name LIKE ? OR service LIKE ? OR venue LIKE ?)'); const like=`%${q}%`; binds.push(like,like,like,like,like,like)}
  if(from){where.push('event_date>=?');binds.push(from)} if(to){where.push('event_date<=?');binds.push(to)}
  const stmt=env.DB.prepare(`SELECT * FROM bookings WHERE ${where.join(' AND ')} ORDER BY event_date ASC LIMIT 100`).bind(...binds)
  const {results}=await stmt.all<any>(); const out=[]
  for(const b of results){const {results:items}=await env.DB.prepare('SELECT * FROM checklist_items WHERE booking_id=? ORDER BY sort_order,id').bind(b.id).all<any>();out.push({...b,checklist:items.map(i=>({...i,completed:!!i.completed}))})}
  return json({items:out,count:out.length})
}

export const onRequestPost: PagesFunction<Env> = async ({env,request}) => {
  const auth=await requireAIClient(env,request,'create'); if(auth.error)return auth.error; const {client}=auth
  const b:any=await request.json(); const id=b.id||crypto.randomUUID(); const nowYear=new Date().getFullYear(); const reference=b.reference||`AI-${nowYear}-${Math.floor(1000+Math.random()*9000)}`
  if(!b.client_name||!b.event_name||!b.brand||!b.service||!b.event_date) return json({error:'client_name, event_name, brand, service and event_date are required'},400)
  await env.DB.prepare(`INSERT INTO bookings (id,reference,client_name,company,event_name,brand,service,status,event_date,event_start,event_end,access_time,setup_ready_by,collection_time,venue,venue_address,contact_phone,contact_email,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,reference,b.client_name,b.company||null,b.event_name,b.brand,b.service,b.status||'Confirmed',b.event_date,b.event_start||null,b.event_end||null,b.access_time||null,b.setup_ready_by||null,b.collection_time||null,b.venue||null,b.venue_address||null,b.contact_phone||null,b.contact_email||null,b.notes||null).run()
  if(Array.isArray(b.checklist)) for(let n=0;n<b.checklist.length;n++){const i=b.checklist[n];await env.DB.prepare('INSERT INTO checklist_items (id,booking_id,title,completed,due_date,owner,sort_order) VALUES (?,?,?,?,?,?,?)').bind(i.id||crypto.randomUUID(),id,i.title,i.completed?1:0,i.due_date||null,i.owner||null,n).run()}
  const saved={...b,id,reference}; await audit(env,{booking_id:id,actor_name:client!.name,action:'booking.create',summary:`Created ${reference} - ${b.event_name}`,after:saved}); return json(saved,201)
}
