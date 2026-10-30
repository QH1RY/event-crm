import { requireAIClient } from '../../_auth'
import { json, mutateEnquiry, readEnquiry } from '../../../_enquiries'
interface Env { DB: D1Database }
export const onRequestGet: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'read'); if(auth.error)return auth.error
  const e=await readEnquiry(env.DB,String(params.id)); return e?json(e):json({error:'Enquiry not found'},404)
}
export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'update'); if(auth.error)return auth.error
  return mutateEnquiry(env.DB,String(params.id),await request.json().catch(()=>null),{name:auth.client!.name,type:'ai'})
}
