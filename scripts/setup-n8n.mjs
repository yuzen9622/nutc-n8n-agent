import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const MAX_INPUT_BYTES=64*1024;
const workflowIds=['campusNativeAgentLive','campusKnowledgeIngest','campusGoogleSearch'];
const targets=[
  {id:'campus-agent-postgres',name:'Campus Agent Postgres',type:'postgres'},
  {id:'campus-live-service',name:'Campus live service',type:'httpHeaderAuth'},
  {id:'campus-live-webhook',name:'Campus live webhook',type:'httpHeaderAuth'},
];
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export function setupPlan(input,workflows){
  if(typeof input!=='string'||!input.trim()||Buffer.byteLength(input)>MAX_INPUT_BYTES)throw new Error('SETUP_INVALID_INPUT');
  let credentials;
  try{credentials=JSON.parse(input);}catch{throw new Error('SETUP_INVALID_INPUT');}
  if(!Array.isArray(credentials)||credentials.length!==3)throw new Error('SETUP_INVALID_INPUT');
  for(const target of targets){
    const c=credentials.find(c=>c?.id===target.id);
    if(!exactKeys(c,['id','name','type','data'])||c.name!==target.name||c.type!==target.type)throw new Error('SETUP_INVALID_INPUT');
    const d=c.data;
    if(target.type==='postgres'){
      if(!exactKeys(d,['host','port','database','user','password','ssl'])||d.host!=='postgres'||d.port!==5432||d.database!=='campus_agent'||d.user!=='campus_agent'||d.ssl!=='disable'||typeof d.password!=='string'||!d.password.length)throw new Error('SETUP_INVALID_INPUT');
    }else if(!exactKeys(d,['name','value'])||d.name!==(target.id==='campus-live-service'?'X-Campus-Service':'X-Campus-Webhook')||typeof d.value!=='string'||!/^[a-f0-9]{64}$/.test(d.value))throw new Error('SETUP_INVALID_INPUT');
  }
  if(!Array.isArray(workflows)||workflows.length!==3||workflowIds.some(id=>!workflows.some(w=>w?.id===id)))throw new Error('SETUP_INVALID_WORKFLOWS');
  for(const workflow of workflows){
    if(workflow.active!==false||!Array.isArray(workflow.nodes)||!workflow.connections||typeof workflow.connections!=='object')throw new Error('SETUP_INVALID_WORKFLOWS');
    for(const node of workflow.nodes){
      if(!node||typeof node.type!=='string')throw new Error('SETUP_INVALID_WORKFLOWS');
      if(/google|gemini/i.test(node.type)&&Object.keys(node.credentials??{}).length)throw new Error('SETUP_UNKNOWN_CREDENTIAL');
      for(const [type,ref] of Object.entries(node.credentials??{})){
        if(!targets.some(c=>c.id===ref?.id&&c.type===type&&c.name===ref?.name))throw new Error('SETUP_UNKNOWN_CREDENTIAL');
      }
    }
  }
  return [
    {args:['import:credentials','--input=/dev/stdin'],input:JSON.stringify(credentials)},
    {args:['import:workflow','--input=/dev/stdin'],input:JSON.stringify(workflows)},
  ];
}

export async function setupN8n({client,loadWorkflows,runCli,input,log=console.log}){
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(hashtextextended('campus-n8n-setup',0)) AS locked");
    locked=lock.rows[0]?.locked===true;
    if(!locked)throw new Error('SETUP_ALREADY_RUNNING');
    const owner=await client.query('SELECT EXISTS(SELECT 1 FROM "user" WHERE email IS NOT NULL) AS configured');
    if(!owner.rows[0]?.configured)throw new Error('SETUP_OWNER_REQUIRED');
    const existing=await client.query('SELECT EXISTS(SELECT 1 FROM credentials_entity WHERE id = ANY($1::varchar[])) OR EXISTS(SELECT 1 FROM workflow_entity WHERE id = ANY($2::varchar[])) AS existing',[targets.map(c=>c.id),workflowIds]);
    if(existing.rows[0]?.existing)throw new Error('SETUP_TARGET_EXISTS');
    const commands=setupPlan(input,await loadWorkflows());
    for(const command of commands){
      try{await runCli(command);}catch{throw new Error(`SETUP_CLI_${command.args[0].replace(':','_').toUpperCase()}_FAILED`);}
      log(command.args[0]==='import:credentials'?'n8n setup: internal credentials imported.':'n8n setup: three workflows imported inactive; configure Google credentials and publish in the editor.');
    }
    return 'initialized';
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended('campus-n8n-setup',0))");
  }
}

async function readInput(stream){
  const chunks=[];let bytes=0;
  for await(const chunk of stream){
    bytes+=Buffer.byteLength(chunk);
    if(bytes>MAX_INPUT_BYTES)throw new Error('SETUP_INVALID_INPUT');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(){
  let client;
  try{
    const input=await readInput(process.stdin);
    const {default:pg}=await import('/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js');
    client=new pg.Client({host:process.env.DB_POSTGRESDB_HOST,port:Number(process.env.DB_POSTGRESDB_PORT||5432),database:process.env.DB_POSTGRESDB_DATABASE,user:process.env.DB_POSTGRESDB_USER,password:process.env.DB_POSTGRESDB_PASSWORD});
    await client.connect();
    await setupN8n({client,input,
      loadWorkflows:()=>workflowIds.map(id=>JSON.parse(readFileSync(`/import/agent/${id}.json`,'utf8'))),
      // cat converts Node's child socket into an anonymous pipe reopenable by the CLI.
      runCli:({args,input})=>execFileSync('/bin/sh',['-c','cat | n8n "$@"','campus-n8n-cli',...args],{input,stdio:['pipe','pipe','pipe'],timeout:120_000,maxBuffer:1024*1024}),
    });
  }catch(error){
    const code=/^SETUP_[A-Z_]+$/.test(error?.message)?error.message:'SETUP_FAILED';
    console.error(`${code}: setup stopped; preserve the database and inspect before manual recovery. Raw output withheld.`);
    process.exitCode=1;
  }finally{
    if(client)try{await client.end();}catch{console.error('SETUP_CONNECTION_CLOSE_FAILED: raw output withheld.');process.exitCode=1;}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
