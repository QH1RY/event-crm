import { createEnquiry, listEnquiries } from '../_enquiries'
interface Env { DB: D1Database }
// Browser route: protected by Cloudflare Access in _middleware.ts.
export const onRequestGet: PagesFunction<Env> = async ({env,request}) => listEnquiries(env.DB,new URL(request.url).searchParams)
export const onRequestPost: PagesFunction<Env> = async ({env,request}) =>
  createEnquiry(env.DB,await request.json().catch(()=>null),{name:'CRM user',type:'user'})
