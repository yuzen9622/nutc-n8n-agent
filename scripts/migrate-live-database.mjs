import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {requiredEnv} from './env.mjs';
const names=['002-line-inbox.sql','003-task-dispatch.sql','004-public-evidence.sql','005-school-sessions.sql','006-liff-sessions.sql','007-private-results.sql','008-knowledge-corpus.sql','009-school-login-notice.sql','010-google-grounded-results.sql','011-provider-http-outcomes.sql','012-school-login-outcomes.sql','013-school-auth-rejections.sql','014-extended-private-operations.sql','015-public-line-access.sql','016-runtime-key.sql'];
const migrations=names.map(name=>{const content=readFileSync(new URL(`../apps/gateway/migrations/${name}`,import.meta.url),'utf8');return {name,checksum:createHash('sha256').update(content).digest('hex'),sql:content.replace(/^BEGIN;\s*$/gm,'').replace(/^COMMIT;\s*$/gm,'')};});
const keyGuardUrl='data:text/javascript;base64,'+Buffer.from(readFileSync(new URL('../apps/shared/runtime-key-guard.mjs',import.meta.url),'utf8')).toString('base64');
const source=`
const {guardRuntimeKey}=await import(${JSON.stringify(keyGuardUrl)});
import pg from '${process.argv.includes('--container')?'pg':'/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js'}';
const client=new pg.Client({host:'postgres',database:'campus_agent',user:'campus_agent',password:process.env.POSTGRES_PASSWORD});
await client.connect();
try{
 await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('campus-live-migrations',0))");
 const state=await client.query("SELECT to_regclass('public.campus_migrations') ledger,to_regclass('public.campus_identities') identities");
 if(!state.rows[0].ledger && state.rows[0].identities)throw Error('UNTRACKED_LIVE_SCHEMA');
 await client.query('CREATE TABLE IF NOT EXISTS campus_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
 const applied=[];
 for(const migration of ${JSON.stringify(migrations)}){
  const previous=await client.query('SELECT checksum FROM campus_migrations WHERE name=$1',[migration.name]);
  if(previous.rowCount){if(previous.rows[0].checksum!==migration.checksum)throw Error('MIGRATION_CHECKSUM_MISMATCH');continue;}
  await client.query(migration.sql);await client.query('INSERT INTO campus_migrations(name,checksum) VALUES($1,$2)',[migration.name,migration.checksum]);applied.push(migration.name);
 }
 await guardRuntimeKey(client,process.env.APP_MASTER_KEY);
 await client.query('COMMIT');console.log(JSON.stringify({database:'campus_agent',applied}));
}catch(error){await client.query('ROLLBACK');console.log(JSON.stringify({error:error.code??error.message}));process.exitCode=1;}finally{await client.end();}
`;
try{
 const inContainer=process.argv.includes('--container');
 const command=inContainer?process.execPath:'docker';
 const args=inContainer?['--input-type=module']:['compose','--env-file','.env','exec','-T','-e','POSTGRES_PASSWORD','-e','APP_MASTER_KEY','n8n','node','--input-type=module'];
 const env={...process.env,POSTGRES_PASSWORD:requiredEnv('POSTGRES_PASSWORD'),APP_MASTER_KEY:requiredEnv('APP_MASTER_KEY')};
 const output=execFileSync(command,args,{input:source,encoding:'utf8',stdio:['pipe','pipe','pipe'],env});
 console.log(output.trim());
}catch(error){
 const safe=String(error.stdout??'').match(/APP_MASTER_KEY_INVALID|APP_MASTER_KEY_CHANGED|EXISTING_DATA_REQUIRES_KEY_MIGRATION/);
 throw new Error(`${safe?.[0]??'LIVE_DATABASE_MIGRATION_FAILED'}: transaction rolled back; preserve existing data. Raw output withheld.`);
}
