import { json, mutateBooking, readBooking } from '../../_mutations'
interface Env { DB: D1Database }
export const onRequestGet: PagesFunction<Env> = async ({env,params}) => {
  const b=await readBooking(env.DB,String(params.id),true)
  return b?json(b):json({error:'Booking not found'},404)
}
export const onRequestPut: PagesFunction<Env> = async ({env,request,params}) => {
  const body=await request.json().catch(()=>null)
  return mutateBooking(env.DB,String(params.id),body,{name:'CRM user',type:'user'})
}
export const onRequestDelete: PagesFunction<Env> = async ({env,request,params}) =>
  mutateBooking(env.DB,String(params.id),await request.json().catch(()=>null),{name:'CRM user',type:'user'},undefined,'archive')
export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) => {
  const body:any=await request.json().catch(()=>null)
  return mutateBooking(env.DB,String(params.id),body,{name:'CRM user',type:'user'},undefined,body?.restore?'restore':undefined)
}
