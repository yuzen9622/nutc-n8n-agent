import {execFileSync} from 'node:child_process';
import './env.mjs';
// Native credentials remain encrypted in n8n's database. Never write an import file.
export function importCredentials(credentials){
 try{
  execFileSync('docker',['compose','--env-file','.env','-f','infra/compose.yaml','exec','-T','n8n','n8n','import:credentials','--input=/dev/stdin'],{input:JSON.stringify(credentials),stdio:['pipe','pipe','pipe']});
 }catch{throw Error('Credential import through stdin failed; raw output withheld.');}
}
