export const onRequestGet: PagesFunction = async () => new Response(JSON.stringify({ok:true,service:'booking-crm-ai-api',version:'0.2.0'}),{headers:{'content-type':'application/json'}})
