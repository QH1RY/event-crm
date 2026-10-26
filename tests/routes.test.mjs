import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync,readFileSync,existsSync } from 'node:fs'
import { dirname,join,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
const root=fileURLToPath(new URL('../functions',import.meta.url))
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)])}
test('every Pages Function parses and its relative imports resolve',()=>{
 for(const path of walk(root).filter(p=>p.endsWith('.ts'))){
  const source=readFileSync(path,'utf8');stripTypeScriptTypes(source)
  for(const [,ref] of source.matchAll(/from ['"]([^'"]+)['"]/g)){
   if(ref.startsWith('.'))assert.ok(existsSync(resolve(dirname(path),ref+'.ts')),'Unresolved '+ref+' in '+path)
  }
 }
})
