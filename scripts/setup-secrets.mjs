import {mkdirSync,writeFileSync,existsSync,readFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
mkdirSync('.local/secrets',{recursive:true,mode:0o700});
for(const name of ['postgres_admin','n8n_db_password','n8n_encryption','task','demo','maintenance','knowledge','observability','webhook']) {
 const path=`.local/secrets/${name}`;
 if(!existsSync(path))writeFileSync(path,randomBytes(32).toString('hex'),{mode:0o644});
 chmodSync(path,0o644); // Parent is 0700; mounted secrets must be readable by container UID.
}
const scopes=['task','demo','maintenance','knowledge','observability','webhook'];
writeFileSync('.local/credentials.json',JSON.stringify(scopes.map(scope=>({id:`campus-${scope}-synthetic`,name:`Campus synthetic ${scope}`,type:'httpHeaderAuth',data:{name:scope==='webhook'?'X-Campus-Webhook':'Authorization',value:(scope==='webhook'?'':'Bearer ')+readFileSync(`.local/secrets/${scope}`,'utf8')}}))),{mode:0o600});
console.log('Synthetic secrets prepared; values not printed.');
