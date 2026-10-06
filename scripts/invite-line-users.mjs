import {execFileSync} from 'node:child_process';
import {requiredEnv} from './env.mjs';
import {readFileSync} from 'node:fs';
const ids=[...new Set(requiredEnv('INVITED_LINE_USER_IDS').split(',').map(value=>value.trim()).filter(Boolean))];
if(!ids.length||ids.length>20||ids.some(value=>!/^U[a-f0-9]{32}$/i.test(value)))throw Error('INVITED_LINE_USER_IDS must contain 1–20 valid LINE User IDs');
const faultUrl='data:text/javascript;base64,'+Buffer.from(readFileSync('dist/apps/gateway/src/utils/fault.js','utf8')).toString('base64');
const repository=readFileSync('dist/apps/gateway/src/modules/line/line.repository.js','utf8').replace("'../../utils/fault.js'",JSON.stringify(faultUrl));
const source=`import pg from '/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js';
const {LineRepository}=await import('data:text/javascript;base64,${Buffer.from(repository).toString('base64')}');
const pool=new pg.Pool({host:'postgres',database:'campus_agent',user:'campus_agent',password:process.env.AGENT_DB_PASSWORD});
try{const result=await new LineRepository(pool,'unused-admin-sync-session-key').syncInvitations(${JSON.stringify(ids)});console.log(JSON.stringify(result));}catch{process.exitCode=1;}finally{await pool.end();}`;
try{console.log(execFileSync('docker',['compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','-e','AGENT_DB_PASSWORD','n8n','node','--input-type=module'],{input:source,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,AGENT_DB_PASSWORD:requiredEnv('AGENT_DB_PASSWORD')}}).trim());}catch{throw Error('Invitation update failed; raw output withheld.');}
