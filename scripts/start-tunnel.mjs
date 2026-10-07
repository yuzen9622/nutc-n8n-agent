import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requiredEnv} from './env.mjs';
const credentials=requiredEnv('TUNNEL_CRED_CONTENTS');
try {const value=JSON.parse(credentials);if(value.TunnelID!=='fc9524a7-43ef-47d4-bf18-2d0a11d954c1' || !value.TunnelSecret || !value.AccountTag)throw new Error();}catch{throw new Error('Invalid tunnel credentials in .env');}
const env=Object.fromEntries(['PATH','HOME','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.TUNNEL_CRED_CONTENTS=credentials;
// Materialize only this process's temporary config; no separate infra files.
const directory=mkdtempSync(join(tmpdir(),'campus-tunnel-'));
const config=join(directory,'config.yaml');
writeFileSync(config,`tunnel: fc9524a7-43ef-47d4-bf18-2d0a11d954c1
metrics: 127.0.0.1:20311
loglevel: warn
ingress:
  - hostname: nutc-agent.yuzen.dev
    path: ^/(liff(/.*)?|line/webhook)$
    service: http://127.0.0.1:3101
  - service: http_status:404
`,{mode:0o600});
const cleanup=()=>rmSync(directory,{recursive:true,force:true});
process.once('exit',cleanup);
const child=spawn('cloudflared',['tunnel','--config',config,'--no-autoupdate','run','fc9524a7-43ef-47d4-bf18-2d0a11d954c1'],{env,stdio:['ignore','inherit','inherit']});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('error',()=>{console.error('Unable to start cloudflared');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
