import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {envPath} from './env.mjs';
const env=existsSync(envPath)?parseEnv(readFileSync(envPath,'utf8')):{};
const secrets=Object.entries(env).filter(([k])=>/TOKEN|SECRET|PASSWORD|KEY|CRED_CONTENTS|DATABASE_URL/.test(k)).map(([,v])=>v).filter(v=>v.length>=12);
if(env.TUNNEL_CRED_CONTENTS){const cf=JSON.parse(env.TUNNEL_CRED_CONTENTS);secrets.push(cf.TunnelSecret);}
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){if(!existsSync(file))continue;const content=readFileSync(file);if(secrets.some(s=>s&&content.includes(Buffer.from(s))))throw Error(`Secret leaked into ${file}`);}
console.log(`Checked ${files.length} Git-visible files against .env secrets; no values printed.`);

function checkLocal(directory){
 if(!existsSync(directory))return;
 for(const item of readdirSync(directory,{withFileTypes:true})){
  const path=`${directory}/${item.name}`;
  if(item.isDirectory())checkLocal(path);
  else if(item.isFile() && statSync(path).size<20_000_000){
   const data=readFileSync(path);if(secrets.some(value=>data.includes(Buffer.from(value))))throw Error(`Duplicate secret file outside .env: ${path}`);
  }
 }
}
checkLocal('.local');
console.log('No .env secret copies found in .local.');
