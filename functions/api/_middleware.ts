// Browser data routes must not rely solely on a recommendation to enable Access.
interface Env { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }
const reject=(message:string,status=401)=>new Response(JSON.stringify({error:message}),{status,headers:{'content-type':'application/json'}})
function bytes(value:string) {
  const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'))
  return Uint8Array.from(raw,c=>c.charCodeAt(0))
}
export async function verifyAccess(request:Request,env:Env,fetchKeys:typeof fetch=fetch) {
  const domain=env.ACCESS_TEAM_DOMAIN, audience=env.ACCESS_AUD
  if (!domain || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience) return false
  const token=request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return false
  try {
    const [head,body,signature,...extra]=token.split('.')
    if (!head || !body || !signature || extra.length) return false
    const header=JSON.parse(new TextDecoder().decode(bytes(head)))
    const claims=JSON.parse(new TextDecoder().decode(bytes(body)))
    const now=Math.floor(Date.now()/1000)
    if (header.alg!=='RS256' || typeof header.kid!=='string' ||
        claims.iss!=='https://'+domain || typeof claims.exp!=='number' || claims.exp<=now ||
        (claims.nbf!==undefined && (typeof claims.nbf!=='number' || claims.nbf>now)) ||
        !(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(audience)) return false
    const response=await fetchKeys('https://'+domain+'/cdn-cgi/access/certs')
    if (!response.ok) return false
    const jwks:any=await response.json()
    const jwk=jwks.keys?.find((key:any)=>key.kid===header.kid && key.kty==='RSA')
    if (!jwk) return false
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'])
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(signature),new TextEncoder().encode(head+'.'+body))
  } catch { return false }
}
export const onRequest: PagesFunction<Env> = async ({request,env,next}) => {
  const path=new URL(request.url).pathname
  if (path==='/api/setup' || path==='/api/setup/' || path==='/api/bookings' || path.startsWith('/api/bookings/') || path==='/api/enquiries' || path.startsWith('/api/enquiries/')) {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return reject('Cloudflare Access must be configured before booking and enquiry data can be opened.',503)
    if (!await verifyAccess(request,env)) return reject('Sign in through Cloudflare Access to open booking and enquiry data.')
  }
  return next()
}
