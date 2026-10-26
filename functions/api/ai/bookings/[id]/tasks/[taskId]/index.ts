import { requireAIClient } from '../../../../_auth'
import { mutateBooking } from '../../../../../_mutations'
interface Env { DB: D1Database }
export const onRequestPatch: PagesFunction<Env> = async ({env,request,params}) => {
  const auth=await requireAIClient(env,request,'update'); if(auth.error)return auth.error
  return mutateBooking(env.DB,String(params.id),await request.json().catch(()=>null),
    {name:auth.client!.name,type:'ai'},
    {action:'update',id:String(params.taskId)})
}
