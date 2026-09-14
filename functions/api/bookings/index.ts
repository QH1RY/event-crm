interface Env { DB: D1Database }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
export const onRequestGet: PagesFunction<Env> = async ({env}) => {
  const {results}=await env.DB.prepare('SELECT * FROM bookings ORDER BY event_date ASC').all<any>()
  const out=[]
  for(const b of results){const {results:items}=await env.DB.prepare('SELECT * FROM checklist_items WHERE booking_id=? ORDER BY sort_order,id').bind(b.id).all<any>();out.push({...b,checklist:items.map(i=>({...i,completed:!!i.completed}))})}
  return json(out)
}
export const onRequestPost: PagesFunction<Env> = async ({env,request}) => {
  const b:any=await request.json()
  await env.DB.prepare(`INSERT INTO bookings (id,reference,client_name,company,event_name,brand,service,status,event_date,event_start,event_end,access_time,setup_ready_by,collection_time,venue,venue_address,contact_phone,contact_email,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(b.id,b.reference,b.client_name,b.company||null,b.event_name,b.brand,b.service,b.status||'Confirmed',b.event_date,b.event_start||null,b.event_end||null,b.access_time||null,b.setup_ready_by||null,b.collection_time||null,b.venue||null,b.venue_address||null,b.contact_phone||null,b.contact_email||null,b.notes||null).run()
  if(Array.isArray(b.checklist)) for(let n=0;n<b.checklist.length;n++){const i=b.checklist[n];await env.DB.prepare('INSERT INTO checklist_items (id,booking_id,title,completed,due_date,owner,sort_order) VALUES (?,?,?,?,?,?,?)').bind(i.id,b.id,i.title,i.completed?1:0,i.due_date||null,i.owner||null,n).run()}
  return json(b,201)
}
