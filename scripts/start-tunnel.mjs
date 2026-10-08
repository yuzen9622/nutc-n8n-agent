import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Reuse locally-managed Tunnel credentials; no token or secret is written to YAML.
export function tunnelConfig(env){
  let credentials,origin;
  try{
    credentials=JSON.parse(env.TUNNEL_CRED_CONTENTS);
    origin=new URL(env.PUBLIC_ORIGIN);
  }catch{throw new Error('INVALID_TUNNEL_CONFIG');}
  if(!credentials || typeof credentials!=='object' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credentials.TunnelID??'') ||
    typeof credentials.TunnelSecret!=='string' || !credentials.TunnelSecret ||
    typeof credentials.AccountTag!=='string' || !credentials.AccountTag ||
    origin.protocol!=='https:' || origin.origin!==env.PUBLIC_ORIGIN || origin.username || origin.password){
    throw new Error('INVALID_TUNNEL_CONFIG');
  }
  const upstream=env.TUNNEL_INGRESS_ORIGIN??'http://127.0.0.1:3101';
  if(!['http://127.0.0.1:3101','http://public-ingress:3101'].includes(upstream))throw new Error('INVALID_TUNNEL_INGRESS_ORIGIN');
  return {id:credentials.TunnelID,yaml:`tunnel: ${credentials.TunnelID}
metrics: 127.0.0.1:20311
loglevel: warn
ingress:
  - hostname: ${JSON.stringify(origin.hostname)}
    path: ^/(liff(/.*)?|line/webhook)$
    service: ${upstream}
  - service: http_status:404
`};
}

async function main(){
  await import('./env.mjs');
  let settings;
  try{settings=tunnelConfig(process.env);}catch(error){console.error(error.message);process.exitCode=1;return;}
  const env=Object.fromEntries(['PATH','HOME','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  env.TUNNEL_CRED_CONTENTS=process.env.TUNNEL_CRED_CONTENTS;
  const directory=mkdtempSync(join(tmpdir(),'campus-tunnel-'));
  const config=join(directory,'config.yaml');
  const cleanup=()=>rmSync(directory,{recursive:true,force:true});
  process.once('exit',cleanup);
  writeFileSync(config,settings.yaml,{mode:0o600});
  const child=spawn('cloudflared',['tunnel','--config',config,'--no-autoupdate','run',settings.id],{env,stdio:['ignore','inherit','inherit']});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{console.error('Unable to start cloudflared');process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
