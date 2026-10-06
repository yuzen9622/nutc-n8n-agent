import {requiredEnv,ensureEnv} from './env.mjs';
import {randomBytes} from 'node:crypto';
export const base=process.env.N8N_BASE_URL || 'http://localhost:15679';
export async function session(setup=false) {
 if(setup){
  ensureEnv('N8N_OWNER_EMAIL',()=> 'admin@campus.invalid');
  ensureEnv('N8N_OWNER_FIRST_NAME',()=> 'Campus');
  ensureEnv('N8N_OWNER_LAST_NAME',()=> 'Local');
  ensureEnv('N8N_OWNER_PASSWORD',()=>randomBytes(24).toString('base64url')+'aA1!');
 }
 const owner={email:requiredEnv('N8N_OWNER_EMAIL'),password:requiredEnv('N8N_OWNER_PASSWORD'),firstName:process.env.N8N_OWNER_FIRST_NAME||'Campus',lastName:process.env.N8N_OWNER_LAST_NAME||'Local'};
 const r=await fetch(`${base}/rest/${setup?'owner/setup':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(setup?owner:{emailOrLdapLoginId:owner.email,password:owner.password})});
 if(!r.ok)throw new Error(`n8n ${setup?'setup':'login'}: ${r.status} ${await r.text()}`);
 const cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 return async(path,method='GET',body)=>{
  const response=await fetch(`${base}/rest${path}`,{method,headers:{'Content-Type':'application/json',cookie},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data).slice(0,1200)}`);return data.data??data;
 };
}
if(process.argv[2]==='setup-owner') {await session(true);console.log('Local owner initialized; login details in .env (0600).');}
