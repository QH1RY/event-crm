import { requireAIClient } from '../_auth'
import { createEnquiry, listEnquiries } from '../../_enquiries'
interface Env { DB: D1Database }
export const onRequestGet: PagesFunction<Env> = async ({env,request}) => {
  const auth=await requireAIClient(env,request,'read'); if(auth.error)return auth.error
  return listEnquiries(env.DB,new URL(request.url).searchParams)
}
export const onRequestPost: PagesFunction<Env> = async ({env,request}) => {
  const auth=await requireAIClient(env,request,'create'); if(auth.error)return auth.error
  return createEnquiry(env.DB,await request.json().catch(()=>null),{name:auth.client!.name,type:'ai'})
}
