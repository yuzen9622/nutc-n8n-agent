import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {TaskRepository} from '../apps/gateway/src/modules/tasks/task.repository.js';

test('private-result GCM accepts existing full tags and rejects shortened tags or other owners',()=>{
 const repository=new TaskRepository({} as Pool,'synthetic-private-crypto-secret-32-bytes');
 // Exercise the actual cipher helper; no mocked encryption or database claims.
 const crypt=Reflect.get(repository,'crypt').bind(repository) as (text:string,context:string,open?:boolean)=>string;
 const context='task:lease:owner-a',plaintext='SYNTHETIC PRIVATE RESULT',encrypted=crypt(plaintext,context);
 assert.equal(crypt(encrypted,context,true),plaintext);
 const parts=encrypted.split('.');
 const tag=Buffer.from(parts[1]!,'base64url');
 assert.equal(tag.length,16);
 for(const bytes of [4,8,12]){
  const shortened=[parts[0],tag.subarray(0,bytes).toString('base64url'),parts[2]].join('.');
  assert.throws(()=>crypt(shortened,context,true),/PRIVATE_RESULT_UNAVAILABLE/);
 }
 assert.throws(()=>crypt(encrypted,'task:lease:owner-b',true),/PRIVATE_RESULT_UNAVAILABLE/);
 assert.throws(()=>crypt('malformed',context,true),/PRIVATE_RESULT_UNAVAILABLE/);
});
