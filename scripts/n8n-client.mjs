import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
export const base=process.env.N8N_BASE_URL || 'http://localhost:15679';
const ownerFile='.local/owner.json';
export async function session(setup=false) {
 if(!existsSync(ownerFile)) {
  if(!setup)throw new Error('Run setup-owner first');
  writeFileSync(ownerFile,JSON.stringify({email:'admin@campus.invalid',firstName:'Campus',lastName:'Local',password:randomBytes(24).toString('base64url')+'aA1!'},null,2),{mode:0o600});
 }
 const owner=JSON.parse(readFileSync(ownerFile));
 const r=await fetch(`${base}/rest/${setup?'owner/setup':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(setup?owner:{emailOrLdapLoginId:owner.email,password:owner.password})});
 if(!r.ok)throw new Error(`n8n ${setup?'setup':'login'}: ${r.status} ${await r.text()}`);
 const cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 return async(path,method='GET',body)=>{
  const response=await fetch(`${base}/rest${path}`,{method,headers:{'Content-Type':'application/json',cookie},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data).slice(0,1200)}`);return data.data??data;
 };
}
if(process.argv[2]==='setup-owner') {await session(true);console.log('Local owner initialized; login details in .local/owner.json (0600).');}
