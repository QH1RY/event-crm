import { mutateBooking } from '../../../../_mutations'
interface Env { DB: D1Database }
export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) => {
  
  return mutateBooking(env.DB,String(params.id),await request.json().catch(()=>null),
    {name:'CRM user',type:'user'},
    {action:'update',id:String(params.taskId)})
}
