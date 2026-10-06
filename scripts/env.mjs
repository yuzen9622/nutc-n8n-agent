import {readFileSync,writeFileSync,existsSync,chmodSync,renameSync} from 'node:fs';
import {parseEnv} from 'node:util';
export const envPath=new URL('../.env',import.meta.url);
if(existsSync(envPath))process.loadEnvFile(envPath);
export function requiredEnv(name){
 const value=process.env[name];if(!value)throw Error(`Missing ${name} in .env`);return value;
}
export function ensureEnv(name,create){
 if(process.env[name])return process.env[name];
 const value=create();setEnvValues({[name]:value});return value;
}
export function setEnvValues(values){
 const before=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
 const current=parseEnv(before);let next=before;
 for(const [key,value] of Object.entries(values)){
  if(!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value!=='string' || /['\r\n]/.test(value))throw Error('Unsupported generated env entry');
  if(current[key] && current[key]!==value)throw Error(`Existing ${key} differs; refusing to overwrite`);
  if(current[key]===value)continue;
  next=next.replace(new RegExp(`^${key}=.*$`,'m'),'');
  next+=`\n${key}='${value}'\n`;
 }
 const parsed=parseEnv(next);for(const [key,value]of Object.entries(values))if(parsed[key]!==value)throw Error('Env serialization mismatch');
 const temporary=new URL('../.env.migrating',import.meta.url);
 writeFileSync(temporary,next,{mode:0o600});chmodSync(temporary,0o600);renameSync(temporary,envPath);chmodSync(envPath,0o600);
 for(const [key,value]of Object.entries(values))process.env[key]=value;
}
