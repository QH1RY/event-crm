import { json, mutateEnquiry, readEnquiry } from '../../_enquiries'
interface Env { DB: D1Database }
// Enquiries are never deleted or archived: there is intentionally no DELETE handler.
export const onRequestGet: PagesFunction<Env> = async ({env,params}) => {
  const e=await readEnquiry(env.DB,String(params.id))
  return e?json(e):json({error:'Enquiry not found'},404)
}
export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) =>
  mutateEnquiry(env.DB,String(params.id),await request.json().catch(()=>null),{name:'CRM user',type:'user'})
