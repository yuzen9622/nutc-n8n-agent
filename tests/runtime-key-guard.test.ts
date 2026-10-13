import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guardRuntimeKey,assertRuntimeKey} from '../apps/shared/runtime-key-guard.mjs';
import {readFileSync} from 'node:fs';

// Unit coverage of the guard's branching only; transaction behavior requires PG.
function db(fingerprint?:string,existing=false){
 const writes:string[][]=[];
 return {writes,query:async(sql:string,params?:string[])=>{
  if(sql.startsWith('SELECT fingerprint'))return {rows:fingerprint?[{fingerprint}]:[]};
  if(sql.startsWith('SELECT EXISTS'))return {rows:[{existing}]};
  writes.push(params!);return {rows:[]};
 }};
}
test('fresh key is pinned once; same key and equivalent hex case are accepted',async()=>{
 const fresh=db();await guardRuntimeKey(fresh,'ab'.repeat(32));assert.equal(fresh.writes.length,1);
 const same=db(fresh.writes[0]![0]);await guardRuntimeKey(same,'AB'.repeat(32));assert.equal(same.writes.length,0);
});
test('existing identities without a key marker require an explicit migration',async()=>{
 const existing=db(undefined,true);await assert.rejects(guardRuntimeKey(existing,'ab'.repeat(32)),/EXISTING_DATA_REQUIRES_KEY_MIGRATION/);
 assert.equal(existing.writes.length,0);
});
test('different key never overwrites its predecessor',async()=>{
 const fresh=db();await guardRuntimeKey(fresh,'ab'.repeat(32));
 const existing=db(fresh.writes[0]![0]);await assert.rejects(guardRuntimeKey(existing,'cd'.repeat(32)),/APP_MASTER_KEY_CHANGED/);
 assert.equal(existing.writes.length,0);
});
test('server startup key check is read-only, rejects missing/mismatched markers and masks DB errors',async()=>{
 const fresh=db();await guardRuntimeKey(fresh,'ab'.repeat(32));
 const same=db(fresh.writes[0]![0]);await assertRuntimeKey(same,'ab'.repeat(32));assert.equal(same.writes.length,0);
 await assert.rejects(assertRuntimeKey(same,'cd'.repeat(32)),/APP_MASTER_KEY_CHANGED/);
 const empty=db();await assert.rejects(assertRuntimeKey(empty,'ab'.repeat(32)),/APP_MASTER_KEY_NOT_INITIALIZED/);assert.equal(empty.writes.length,0);
 for(const [code,expected] of [['42P01','APP_MASTER_KEY_NOT_INITIALIZED'],['28P01','APP_KEY_CHECK_UNAVAILABLE']]){
  await assert.rejects(assertRuntimeKey({query:async()=>{throw Object.assign(new Error('secret-connection-string'),{code});}},'ab'.repeat(32)),{message:expected});
 }
});
test('both real server entry points check keys before repositories, OCR, workers or listeners',()=>{
 for(const path of ['apps/gateway/src/server.ts','apps/school-adapter/src/server.ts']){
  const source=readFileSync(path,'utf8'),check=source.indexOf('await assertRuntimeKey(pool,process.env.APP_MASTER_KEY)');
  assert(check>=0);
  for(const operation of ['new LineRepository','new TaskRepository','new SchoolSessionRepository','new LocalOcr','new TaskWorker','server.listen']){
   const at=source.indexOf(operation);if(at>=0)assert(check<at,`${path}: ${operation} before key check`);
  }
  assert(source.includes('await pool.end();throw error;'));
 }
});
test('missing or malformed keys are rejected before any query',async()=>{
 const client={query:async()=>{throw new Error('must not query');}};
 for(const key of [undefined,'','not-a-key'])await assert.rejects(guardRuntimeKey(client,key),/APP_MASTER_KEY_INVALID/);
});
