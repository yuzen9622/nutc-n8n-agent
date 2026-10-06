import {spawn} from 'node:child_process';
import {requiredEnv} from './env.mjs';
const credentials=requiredEnv('TUNNEL_CRED_CONTENTS');
try {const value=JSON.parse(credentials);if(value.TunnelID!=='fc9524a7-43ef-47d4-bf18-2d0a11d954c1' || !value.TunnelSecret || !value.AccountTag)throw Error();}catch{throw Error('Invalid tunnel credentials in .env');}
const env=Object.fromEntries(['PATH','HOME','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.TUNNEL_CRED_CONTENTS=credentials;
const child=spawn('cloudflared',['tunnel','--config','infra/cloudflare.yaml','--no-autoupdate','run','fc9524a7-43ef-47d4-bf18-2d0a11d954c1'],{env,stdio:['ignore','inherit','inherit']});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
child.once('error',()=>{console.error('Unable to start cloudflared');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
