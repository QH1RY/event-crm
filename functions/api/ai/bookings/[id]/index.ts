import { requireAIClient } from '../../_auth'
import { json, mutateBooking, readBooking } from '../../../_mutations'
interface Env { DB: D1Database }
export const onRequestGet: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'read'); if(auth.error)return auth.error
  const b=await readBooking(env.DB,String(params.id)); return b?json(b):json({error:'Booking not found'},404)
}
export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'update'); if(auth.error)return auth.error
  return mutateBooking(env.DB,String(params.id),await request.json().catch(()=>null),{name:auth.client!.name,type:'ai'})
}
export const onRequestDelete: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'archive'); if(auth.error)return auth.error
  return mutateBooking(env.DB,String(params.id),await request.json().catch(()=>null),{name:auth.client!.name,type:'ai'},undefined,'archive')
}
