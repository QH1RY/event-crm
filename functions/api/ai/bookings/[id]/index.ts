import { audit, getBooking, requireAIClient } from '../../_auth'
interface Env { DB: D1Database }
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})

export const onRequestGet: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'read'); if(auth.error)return auth.error
  const b=await getBooking(env,String(params.id)); return b?json(b):json({error:'Booking not found'},404)
}

export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'update'); if(auth.error)return auth.error; const {client}=auth; const id=String(params.id)
  const before=await getBooking(env,id); if(!before)return json({error:'Booking not found'},404)
  const p:any=await request.json(); const fields=['client_name','company','event_name','brand','service','status','event_date','event_start','event_end','access_time','setup_ready_by','collection_time','venue','venue_address','contact_phone','contact_email','notes']
  const sets:string[]=[]; const binds:any[]=[]; for(const k of fields){if(Object.prototype.hasOwnProperty.call(p,k)){sets.push(`${k}=?`);binds.push(p[k]??null)}}
  if(sets.length){sets.push('updated_at=CURRENT_TIMESTAMP');await env.DB.prepare(`UPDATE bookings SET ${sets.join(',')} WHERE id=?`).bind(...binds,id).run()}
  if(Array.isArray(p.checklist)){
    await env.DB.prepare('DELETE FROM checklist_items WHERE booking_id=?').bind(id).run()
    for(let n=0;n<p.checklist.length;n++){const i=p.checklist[n];await env.DB.prepare('INSERT INTO checklist_items (id,booking_id,title,completed,due_date,owner,sort_order) VALUES (?,?,?,?,?,?,?)').bind(i.id||crypto.randomUUID(),id,i.title,i.completed?1:0,i.due_date||null,i.owner||null,n).run()}
  }
  const after=await getBooking(env,id); await audit(env,{booking_id:id,actor_name:client!.name,action:'booking.update',summary:`Updated ${before.reference}`,before,after}); return json(after)
}

export const onRequestDelete: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'archive'); if(auth.error)return auth.error; const {client}=auth; const id=String(params.id)
  const before=await getBooking(env,id); if(!before)return json({error:'Booking not found'},404)
  await env.DB.prepare('UPDATE bookings SET archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run(); await audit(env,{booking_id:id,actor_name:client!.name,action:'booking.archive',summary:`Archived ${before.reference}`,before}); return json({ok:true,archived:true,id})
}
