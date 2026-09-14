interface Env { DB: D1Database }

type AIClient = {
  id: string
  name: string
  can_read: number
  can_create: number
  can_update: number
  can_archive: number
  can_delete: number
  is_active: number
}

export async function sha256(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')
}

export async function requireAIClient(env:Env, request:Request, permission:'read'|'create'|'update'|'archive'|'delete'){
  const header=request.headers.get('authorization')||''
  const token=header.toLowerCase().startsWith('bearer ')?header.slice(7).trim():''
  if(!token) return {error:new Response(JSON.stringify({error:'Missing bearer token'}),{status:401,headers:{'content-type':'application/json'}})}
  const hash=await sha256(token)
  const client=await env.DB.prepare('SELECT id,name,can_read,can_create,can_update,can_archive,can_delete,is_active FROM ai_clients WHERE key_hash=?').bind(hash).first<AIClient>()
  if(!client||!client.is_active) return {error:new Response(JSON.stringify({error:'Invalid or inactive AI client'}),{status:401,headers:{'content-type':'application/json'}})}
  const allowed=permission==='read'?client.can_read:permission==='create'?client.can_create:permission==='update'?client.can_update:permission==='archive'?client.can_archive:client.can_delete
  if(!allowed) return {error:new Response(JSON.stringify({error:`${client.name} is not allowed to ${permission}`}),{status:403,headers:{'content-type':'application/json'}})}
  return {client}
}

export async function audit(env:Env, input:{booking_id?:string|null;actor_name:string;action:string;summary?:string;before?:unknown;after?:unknown}){
  await env.DB.prepare('INSERT INTO audit_log (id,booking_id,actor_type,actor_name,action,summary,before_json,after_json) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),input.booking_id||null,'ai',input.actor_name,input.action,input.summary||null,input.before===undefined?null:JSON.stringify(input.before),input.after===undefined?null:JSON.stringify(input.after)).run()
}

export async function getBooking(env:Env,id:string){
  const b=await env.DB.prepare('SELECT * FROM bookings WHERE id=? AND archived_at IS NULL').bind(id).first<any>()
  if(!b) return null
  const {results:items}=await env.DB.prepare('SELECT * FROM checklist_items WHERE booking_id=? ORDER BY sort_order,id').bind(id).all<any>()
  return {...b,checklist:items.map(i=>({...i,completed:!!i.completed}))}
}
