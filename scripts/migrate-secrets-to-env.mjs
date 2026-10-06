import {readFileSync,existsSync} from 'node:fs';
import {setEnvValues,requiredEnv} from './env.mjs';
const mapping={postgres_admin:'POSTGRES_PASSWORD',n8n_db_password:'DB_POSTGRESDB_PASSWORD',n8n_encryption:'N8N_ENCRYPTION_KEY',agent_db_password:'AGENT_DB_PASSWORD',webhook:'MOCK_WEBHOOK_TOKEN',live_service_token:'SERVICE_TOKEN',live_webhook_token:'N8N_WEBHOOK_TOKEN',...Object.fromEntries(['task','demo','maintenance','knowledge','observability'].map(k=>[k,`MOCK_${k.toUpperCase()}_TOKEN`]))};
const values={};
for(const [file,key]of Object.entries(mapping))if(existsSync(`.local/secrets/${file}`))values[key]=readFileSync(`.local/secrets/${file}`,'utf8').trim();
if(existsSync('.local/owner.json')){
 const owner=JSON.parse(readFileSync('.local/owner.json','utf8'));
 for(const [field,key]of Object.entries({email:'N8N_OWNER_EMAIL',password:'N8N_OWNER_PASSWORD',firstName:'N8N_OWNER_FIRST_NAME',lastName:'N8N_OWNER_LAST_NAME'}))values[key]=owner[field];
}
if(existsSync('.local/secrets/cloudflare-nutc-agent.json'))values.TUNNEL_CRED_CONTENTS=JSON.stringify(JSON.parse(readFileSync('.local/secrets/cloudflare-nutc-agent.json','utf8')));
setEnvValues(values);
for(const [key,value]of Object.entries(values))if(requiredEnv(key)!==value)throw Error(`Migration verification failed: ${key}`);
console.log(`Migrated and verified ${Object.keys(values).length} settings; no values printed or rotated. Old files retained until runtime verification.`);
