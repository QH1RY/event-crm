import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
const source = stripTypeScriptTypes(readFileSync(new URL('../functions/api/_mutations.ts',import.meta.url),'utf8'))
const { mutateBooking, readBooking } = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
function fixture(){
 const sql=new DatabaseSync(':memory:')
 for(const file of ['0001_init.sql','0002_ai_access.sql','0003_concurrent_updates.sql'])sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
 sql.exec("INSERT INTO bookings (id,reference,client_name,event_name,brand,service,event_date) VALUES ('b','B1','Client','Event','QH','Booth','2026-11-27')")
 sql.exec("INSERT INTO checklist_items (id,booking_id,title) VALUES ('a','b','Artwork'),('c','b','Equipment')")
 class Statement{
  constructor(query,args=[]){this.query=query;this.args=args}
  bind(...args){return new Statement(this.query,args)}
  async first(){return sql.prepare(this.query).get(...this.args)||null}
  async all(){return {results:sql.prepare(this.query).all(...this.args)}}
  runSync(){const r=sql.prepare(this.query).run(...this.args);return {meta:{changes:Number(r.changes)}}}
  async run(){return this.runSync()}
 }
 const db={prepare:q=>new Statement(q),batch:async statements=>{
  sql.exec('BEGIN IMMEDIATE')
  try{const result=statements.map(s=>s.runSync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 return {db,sql}
}
const actor={name:'Hermes',type:'ai'}
test('individual task update preserves the other task and increments version',async()=>{
 const {db}=fixture()
 const r=await mutateBooking(db,'b',{version:1,completed:true},actor,{action:'update',id:'a'})
 assert.equal(r.status,200)
 const b=await r.json();assert.equal(b.version,2);assert.equal(b.checklist.length,2)
 assert.equal(b.checklist.find(t=>t.id==='c').completed,false)
 assert.equal('write_token' in b,false)
 assert.equal((await db.prepare('SELECT count(*) AS n FROM audit_log').first()).n,1)
})
test('two writers on the same version cannot both commit',async()=>{
 const {db}=fixture()
 const results=await Promise.all([
  mutateBooking(db,'b',{version:1,completed:true},actor,{action:'update',id:'a'}),
  mutateBooking(db,'b',{version:1,completed:true},{name:'Claude',type:'ai'},{action:'update',id:'c'})
 ])
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
 let b=await readBooking(db,'b');assert.equal(b.checklist.filter(t=>t.completed).length,1)
 const other=b.checklist.find(t=>!t.completed)
 assert.equal((await mutateBooking(db,'b',{version:b.version,completed:true},actor,{action:'update',id:other.id})).status,200)
 b=await readBooking(db,'b');assert.equal(b.checklist.filter(t=>t.completed).length,2)
})
test('stale full replacement cannot undo a new task',async()=>{
 const {db}=fixture()
 await mutateBooking(db,'b',{version:1,title:'New task'},actor,{action:'create'})
 assert.equal((await mutateBooking(db,'b',{version:1,checklist:[]},actor)).status,409)
 assert.equal((await readBooking(db,'b')).checklist.length,3)
})
test('missing version, invalid task and wrong task owner do not write',async()=>{
 const {db}=fixture()
 assert.equal((await mutateBooking(db,'b',{notes:'x'},actor)).status,428)
 assert.equal((await mutateBooking(db,'b',{version:1,completed:'false'},actor,{action:'update',id:'a'})).status,400)
 assert.equal((await mutateBooking(db,'b',{version:1,completed:true},actor,{action:'update',id:'unknown'})).status,404)
 assert.equal((await readBooking(db,'b')).version,1)
})
test('audit failure rolls back booking and checklist changes together',async()=>{
 const {db,sql}=fixture();sql.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
 await assert.rejects(mutateBooking(db,'b',{version:1,completed:true},actor,{action:'update',id:'a'}))
 const b=await readBooking(db,'b');assert.equal(b.version,1);assert.equal(b.checklist.find(t=>t.id==='a').completed,false)
})
test('archive conflicts with stale writers and restore also increments version',async()=>{
 const {db}=fixture()
 assert.equal((await mutateBooking(db,'b',{version:1},actor,undefined,'archive')).status,200)
 assert.equal((await mutateBooking(db,'b',{version:1,notes:'stale'},actor)).status,404)
 assert.equal((await mutateBooking(db,'b',{version:2},actor,undefined,'restore')).status,200)
 assert.equal((await readBooking(db,'b')).version,3)
})
