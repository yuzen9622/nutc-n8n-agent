import {pathToFileURL} from 'node:url';
import {runtimeEnv} from '../apps/shared/runtime-config.mjs';

// Only the three application-internal credentials; Google is configured in the editor.
export function buildInternalCredentials(input){
  const env=runtimeEnv(input);
  return [
    {id:'campus-agent-postgres',name:'Campus Agent Postgres',type:'postgres',data:{host:'postgres',port:5432,database:'campus_agent',user:'campus_agent',password:env.POSTGRES_PASSWORD,ssl:'disable'}},
    {id:'campus-live-service',name:'Campus live service',type:'httpHeaderAuth',data:{name:'X-Campus-Service',value:env.SERVICE_TOKEN}},
    {id:'campus-live-webhook',name:'Campus live webhook',type:'httpHeaderAuth',data:{name:'X-Campus-Webhook',value:env.N8N_WEBHOOK_TOKEN}},
  ];
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--json')throw new Error('invalid arguments');
    await import('./env.mjs');
    process.stdout.write(JSON.stringify(buildInternalCredentials(process.env)));
  }catch{
    console.error('SETUP_CREDENTIALS_FAILED: raw output withheld.');
    process.exitCode=1;
  }
}
