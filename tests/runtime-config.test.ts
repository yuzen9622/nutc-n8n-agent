import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeEnv} from '../apps/shared/runtime-config.mjs';
import {loadConfig} from '../apps/gateway/src/config/env.js';
import {loadSchoolConfig} from '../apps/school-adapter/src/config/env.js';
import {SessionCrypto} from '../apps/school-adapter/src/modules/school/session.crypto.js';

const input={APP_MASTER_KEY:'ab'.repeat(32),POSTGRES_PASSWORD:'db:@/ #?%密碼'};
const purposes=['SESSION_SECRET','SERVICE_TOKEN','N8N_WEBHOOK_TOKEN','SCHOOL_SERVICE_TOKEN','SCHOOL_SESSION_KEY','SCHOOL_ACCOUNT_HASH_KEY'] as const;
test('one master key deterministically derives distinct versioned application secrets',()=>{
 const a=runtimeEnv(input),b=runtimeEnv({...input});
 assert.deepEqual(a,b);
 assert.equal(new Set(purposes.map(p=>a[p])).size,purposes.length);
 for(const p of purposes){assert.match(a[p]!,/^[a-f0-9]{64}$/);assert.notEqual(a[p],input.APP_MASTER_KEY);}
 const changed=runtimeEnv({...input,APP_MASTER_KEY:'cd'.repeat(32)});
 for(const p of purposes)assert.notEqual(a[p],changed[p]);
});
test('one database password produces a correctly encoded internal connection URL',()=>{
 const result=runtimeEnv(input);const url=new URL(result.DATABASE_URL!);
 assert.equal(url.hostname,'postgres');assert.equal(url.port,'5432');assert.equal(url.username,'campus_agent');
 assert.equal(decodeURIComponent(url.password),input.POSTGRES_PASSWORD);assert.equal(url.pathname,'/campus_agent');
 assert.equal(result.SCHOOL_DATABASE_URL,result.DATABASE_URL);
 assert.equal(result.N8N_WEBHOOK_URL,'http://n8n:5678/webhook/campus-agent-live');
});
test('master key configuration rejects partial, malformed or ambiguous legacy settings without echoing secrets',()=>{
 for(const value of ['', 'short', 'zz'.repeat(32),'ab'.repeat(31)])assert.throws(()=>runtimeEnv({...input,APP_MASTER_KEY:value}),/APP_MASTER_KEY_INVALID/);
 assert.throws(()=>runtimeEnv({...input,POSTGRES_PASSWORD:''}),/POSTGRES_PASSWORD_REQUIRED/);
 for(const key of purposes)assert.throws(()=>runtimeEnv({...input,[key]:'old-secret'}),/LEGACY_APP_SECRETS_PRESENT/);
 assert.throws(()=>runtimeEnv({...input,DATABASE_URL:'postgresql://old'}),/LEGACY_DATABASE_CONFIG_PRESENT/);
});
test('gateway and school adapter agree on derived auth and restart-safe encryption',()=>{
 const gateway=loadConfig({...input,APP_MODE:'live',LINE_DESTINATION:`U${'a'.repeat(32)}`,LINE_LOGIN_CHANNEL_ID:'2011885607',LINE_CHANNEL_SECRET:'line-secret',LINE_ACCESS_TOKEN:'line-access',SCHOOL_ORIGIN:'http://school-adapter:3200'});
 const school=loadSchoolConfig(input),again=loadSchoolConfig({...input});
 assert.equal(gateway.school!.token,school.SCHOOL_SERVICE_TOKEN);
 assert.equal(gateway.databaseUrl,school.SCHOOL_DATABASE_URL);
 const first=new SessionCrypto(school.SCHOOL_SESSION_KEY,school.SCHOOL_ACCOUNT_HASH_KEY);
 const second=new SessionCrypto(again.SCHOOL_SESSION_KEY,again.SCHOOL_ACCOUNT_HASH_KEY);
 assert.equal(second.open(first.seal('cookie','owner','session'),'owner','session'),'cookie');
 assert.equal(first.accountHash('student'),second.accountHash('student'));
 assert.throws(()=>second.open(first.seal('cookie','owner','session'),'other-owner','session'));
});
test('missing master key never falls back to independently configured legacy secrets',()=>{
 const legacy={SESSION_SECRET:'old-session',SCHOOL_SESSION_KEY:'old-cookie-key',DATABASE_URL:'postgresql://old'};
 assert.throws(()=>runtimeEnv(legacy),/APP_MASTER_KEY_REQUIRED/);
 assert.throws(()=>loadConfig(legacy),/APP_MASTER_KEY_REQUIRED/);
 assert.throws(()=>loadSchoolConfig(legacy),/APP_MASTER_KEY_REQUIRED/);
});
