import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const workflowIds=['campusNativeAgentLive','campusKnowledgeIngest'];
const credentialIds=['campus-agent-postgres','campus-live-service','campus-live-webhook','campus-live-gemini-proxy'];

// A fixed deployment contract, not a general importer. No secret files or CLI arguments.
export function bootstrapPlan(env,workflows){
  for(const name of ['N8N_ENCRYPTION_KEY','SERVICE_TOKEN','N8N_WEBHOOK_TOKEN','GEMINI_PROXY_TOKEN']){
    if(typeof env[name]!=='string'||env[name].length<32)throw new Error(`BOOTSTRAP_REQUIRED_${name}`);
  }
  if(!env.AGENT_DB_PASSWORD)throw new Error('BOOTSTRAP_REQUIRED_AGENT_DB_PASSWORD');
  if(workflows.length!==2||workflowIds.some(id=>!workflows.some(w=>w.id===id)))throw new Error('BOOTSTRAP_INVALID_WORKFLOWS');
  const credentials=[
    {id:credentialIds[0],name:'Campus Agent Postgres',type:'postgres',data:{host:'postgres',port:5432,database:'campus_agent',user:'campus_agent',password:env.AGENT_DB_PASSWORD,ssl:'disable'}},
    {id:credentialIds[1],name:'Campus live service',type:'httpHeaderAuth',data:{name:'X-Campus-Service',value:env.SERVICE_TOKEN}},
    {id:credentialIds[2],name:'Campus live webhook',type:'httpHeaderAuth',data:{name:'X-Campus-Webhook',value:env.N8N_WEBHOOK_TOKEN}},
    {id:credentialIds[3],name:'Campus Gemini proxy',type:'googlePalmApi',data:{apiKey:env.GEMINI_PROXY_TOKEN,host:'http://gateway:3100/providers/gemini'}},
  ];
  for(const workflow of workflows){
    if(workflow.active!==false||!Array.isArray(workflow.nodes)||!workflow.connections)throw new Error('BOOTSTRAP_INVALID_WORKFLOWS');
    for(const node of workflow.nodes){
      for(const [type,ref] of Object.entries(node.credentials??{})){
        if(!credentials.some(c=>c.id===ref.id&&c.type===type&&c.name===ref.name))throw new Error('BOOTSTRAP_UNKNOWN_CREDENTIAL');
      }
    }
  }
  return [
    {args:['import:credentials','--input=/dev/stdin'],input:JSON.stringify(credentials)},
    {args:['import:workflow','--input=/dev/stdin'],input:JSON.stringify(workflows)},
    {args:['publish:workflow','--id=campusNativeAgentLive']},
  ];
}

export async function bootstrapN8n({client,env,loadWorkflows,runCli,log=console.log}){
  let locked=false;
  try{
    const lock=await client.query("SELECT pg_try_advisory_lock(hashtextextended('campus-n8n-bootstrap',0)) AS locked");
    locked=lock.rows[0].locked;
    if(!locked)throw new Error('BOOTSTRAP_ALREADY_RUNNING');
    const marker=await client.query("SELECT to_regclass('campus_bootstrap.state') AS marker");
    if(marker.rows[0].marker){
      const state=await client.query('SELECT status FROM campus_bootstrap.state WHERE id=1');
      if(state.rows[0]?.status!=='complete')throw new Error('BOOTSTRAP_INCOMPLETE');
      log('n8n bootstrap: already initialized; workflows and credentials unchanged.');
      return 'already-initialized';
    }
    // Any existing metadata schema belongs to its administrator. Never migrate/import it here.
    const existing=await client.query(`SELECT
      EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname !~ '^pg_')
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_')
      OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_')
      OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_')
      AS existing`);
    if(existing.rows[0].existing){
      log('n8n bootstrap: existing database detected; automatic import and publication skipped.');
      return 'existing-database';
    }
    const commands=bootstrapPlan(env,loadWorkflows());
    await client.query('BEGIN');
    try{
      await client.query('CREATE SCHEMA campus_bootstrap');
      await client.query("CREATE TABLE campus_bootstrap.state(id integer PRIMARY KEY CHECK(id=1),status text NOT NULL CHECK(status IN ('pending','complete')))");
      await client.query("INSERT INTO campus_bootstrap.state VALUES(1,'pending')");
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
    // Official CLI initializes metadata and its owner project, and encrypts credentials.
    // A failed or interrupted attempt remains pending. Do not overwrite partial/user edits on retry.
    for(const command of commands){
      try{await runCli(command);}
      catch{throw new Error(`BOOTSTRAP_CLI_${command.args[0].replace(':','_').toUpperCase()}_FAILED`);}
    }
    await client.query("UPDATE campus_bootstrap.state SET status='complete' WHERE id=1 AND status='pending'");
    log('n8n bootstrap: two workflows and four credentials imported; main workflow published.');
    return 'initialized';
  }finally{
    if(locked)await client.query("SELECT pg_advisory_unlock(hashtextextended('campus-n8n-bootstrap',0))");
  }
}

async function main(){
  // Reuse pg shipped with the pinned official n8n image; no extra dependency installation.
  const {default:pg}=await import('/usr/local/lib/node_modules/n8n/node_modules/pg/lib/index.js');
  const client=new pg.Client({host:process.env.DB_POSTGRESDB_HOST,port:5432,database:process.env.DB_POSTGRESDB_DATABASE,user:process.env.DB_POSTGRESDB_USER,password:process.env.DB_POSTGRESDB_PASSWORD});
  try{
    await client.connect();
    await bootstrapN8n({client,env:process.env,
      loadWorkflows:()=>workflowIds.map(id=>JSON.parse(readFileSync(new URL(`../workflows/agent/${id}.json`,import.meta.url),'utf8'))),
      // Node's child stdin is a socket: n8n cannot reopen /dev/stdin (ENXIO).
      // cat creates an anonymous pipe that the official CLI can read as a file.
      // All CLI args stay positional; no payload/secret enters shell syntax or argv.
      runCli:({args,input})=>{
        const binary=input===undefined?'n8n':'/bin/sh';
        const cliArgs=input===undefined?args:['-c','cat | n8n "$@"','campus-n8n-cli',...args];
        execFileSync(binary,cliArgs,{input,stdio:['pipe','pipe','pipe'],timeout:120_000,maxBuffer:1024*1024});
      },
    });
  }catch(error){
    // CLI output, connection errors and stack traces may contain secrets. Never echo them.
    const code=/^BOOTSTRAP_[A-Z_]+$/.test(error.message)?error.message:'BOOTSTRAP_FAILED';
    console.error(`${code}: initialization stopped. Preserve the database; inspect configuration before manual recovery. Raw output withheld.`);
    process.exitCode=1;
  }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
