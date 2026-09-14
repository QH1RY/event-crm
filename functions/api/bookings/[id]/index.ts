interface Env { DB: D1Database }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
export const onRequestPut: PagesFunction<Env> = async ({env,request,params}) => {
  const b:any=await request.json(); const id=String(params.id)
  await env.DB.prepare(`UPDATE bookings SET client_name=?,company=?,event_name=?,brand=?,service=?,status=?,event_date=?,event_start=?,event_end=?,access_time=?,setup_ready_by=?,collection_time=?,venue=?,venue_address=?,contact_phone=?,contact_email=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(b.client_name,b.company||null,b.event_name,b.brand,b.service,b.status,b.event_date,b.event_start||null,b.event_end||null,b.access_time||null,b.setup_ready_by||null,b.collection_time||null,b.venue||null,b.venue_address||null,b.contact_phone||null,b.contact_email||null,b.notes||null,id).run()
  await env.DB.prepare('DELETE FROM checklist_items WHERE booking_id=?').bind(id).run()
  if(Array.isArray(b.checklist)) for(let n=0;n<b.checklist.length;n++){const i=b.checklist[n];await env.DB.prepare('INSERT INTO checklist_items (id,booking_id,title,completed,due_date,owner,sort_order) VALUES (?,?,?,?,?,?,?)').bind(i.id,id,i.title,i.completed?1:0,i.due_date||null,i.owner||null,n).run()}
  return json(b)
}
