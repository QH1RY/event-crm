import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source=stripTypeScriptTypes(readFileSync(new URL('../functions/api/_middleware.ts',import.meta.url),'utf8'))
const {verifyAccess,onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const env={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'crm-audience'}
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'}
const keys=async()=>Response.json({keys:[jwk]})
async function request(overrides={},alg='RS256'){
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
 const data=encode({alg,kid:'test-key'})+'.'+encode({iss:'https://test.cloudflareaccess.com',aud:['crm-audience'],exp:Math.floor(Date.now()/1000)+300,...overrides})
 const signature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data))).toString('base64url')
 return new Request('https://crm.example.com/api/bookings',{headers:{'Cf-Access-Jwt-Assertion':data+'.'+signature}})
}
test('valid Access signature and audience are accepted',async()=>assert.equal(await verifyAccess(await request(),env,keys),true))
test('expired, wrong audience, issuer, algorithm and future nbf are rejected',async()=>{
 for(const claims of [{exp:0},{aud:['other']},{iss:'https://evil.example.com'},{nbf:Math.floor(Date.now()/1000)+1000}])
  assert.equal(await verifyAccess(await request(claims),env,keys),false)
 assert.equal(await verifyAccess(await request({},'none'),env,keys),false)
})
test('unsigned or tampered tokens and missing configuration fail closed',async()=>{
 assert.equal(await verifyAccess(new Request('https://crm.example.com'),env,keys),false)
 const req=await request();req.headers.set('Cf-Access-Jwt-Assertion',req.headers.get('Cf-Access-Jwt-Assertion').slice(0,-5)+'wrong')
 assert.equal(await verifyAccess(req,env,keys),false)
 assert.equal(await verifyAccess(await request(),{},keys),false)
})
test('browser bookings and setup routes require Access; AI routes retain bearer handling',async()=>{
 for(const path of ['/api/bookings','/api/bookings/b/tasks','/api/setup']){
  const res=await onRequest({request:new Request('https://crm.example.com'+path),env:{},next:()=>Response.json({leaked:true})})
  assert.equal(res.status,503)
 }
 const res=await onRequest({request:new Request('https://crm.example.com/api/ai/bookings'),env:{},next:()=>Response.json({passed:true})})
 assert.equal((await res.json()).passed,true)
})
