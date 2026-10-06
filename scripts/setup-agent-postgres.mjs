import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const file='.local/secrets/agent_db_password';
if(!existsSync(file))writeFileSync(file,randomBytes(32).toString('hex'),{mode:0o600});
const password=readFileSync(file,'utf8').trim();if(!/^[0-9a-f]{64}$/.test(password))throw Error('Unexpected generated DB secret format');
const psql=(db,sql)=>execFileSync('docker',['compose','-f','infra/compose.yaml','exec','-T','postgres','psql','-v','ON_ERROR_STOP=1','-U','bootstrap','-d',db],{input:sql,stdio:['pipe','pipe','pipe']});
try {
 psql('postgres',`SELECT 'CREATE ROLE campus_agent LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='campus_agent')\n\\gexec\nALTER ROLE campus_agent PASSWORD '${password}';\nSELECT 'CREATE DATABASE campus_agent OWNER campus_agent' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='campus_agent')\n\\gexec\nREVOKE CONNECT ON DATABASE campus_agent FROM PUBLIC;\nGRANT CONNECT ON DATABASE campus_agent TO campus_agent;`);
 psql('campus_agent',`CREATE EXTENSION IF NOT EXISTS vector;\nSET ROLE campus_agent;\nCREATE TABLE IF NOT EXISTS agent_chat_histories (id SERIAL PRIMARY KEY, session_id VARCHAR(255) NOT NULL, message JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());\nCREATE INDEX IF NOT EXISTS agent_chat_session_idx ON agent_chat_histories(session_id,id);\nCREATE TABLE IF NOT EXISTS campus_documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), text TEXT, metadata JSONB, embedding vector);`);
 const credential=[{id:'campus-agent-postgres',name:'Campus Agent Postgres',type:'postgres',data:{host:'postgres',port:5432,database:'campus_agent',user:'campus_agent',password,ssl:'disable',allowUnauthorizedCerts:false}}];
 writeFileSync('.local/agent-postgres-credential.json',JSON.stringify(credential),{mode:0o600});
 execFileSync('docker',['compose','-f','infra/compose.yaml','exec','-T','n8n','n8n','import:credentials','--input=/handoff/agent-postgres-credential.json'],{stdio:['pipe','pipe','pipe']});
 console.log('Dedicated campus_agent database, memory/vector tables and n8n Postgres credential configured. No documents embedded.');
} catch {throw Error('Agent database initialization failed. Inspect container health; secrets intentionally omitted.');}
