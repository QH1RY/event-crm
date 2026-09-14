import { requireAIClient } from '../_auth'
interface Env { DB: D1Database }
export const onRequestGet: PagesFunction<Env> = async ({env,request}) => {
  const auth=await requireAIClient(env,request,'read'); if(auth.error)return auth.error
  const url=new URL(request.url); const booking=url.searchParams.get('booking_id'); const limit=Math.min(Number(url.searchParams.get('limit')||50),100)
  const stmt=booking?env.DB.prepare('SELECT id,booking_id,actor_type,actor_name,action,summary,created_at FROM audit_log WHERE booking_id=? ORDER BY created_at DESC LIMIT ?').bind(booking,limit):env.DB.prepare('SELECT id,booking_id,actor_type,actor_name,action,summary,created_at FROM audit_log ORDER BY created_at DESC LIMIT ?').bind(limit)
  const {results}=await stmt.all(); return new Response(JSON.stringify({items:results}),{headers:{'content-type':'application/json'}})
}
