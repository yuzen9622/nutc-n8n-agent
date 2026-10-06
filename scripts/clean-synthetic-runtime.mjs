import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {session,base} from './n8n-client.mjs';

// User-authorized cleanup, exact IDs only. Never delete arbitrary user workflows,
// official knowledge, credentials for real providers, student sessions or cost ledgers.
const workflowIds=[...Array.from({length:7},(_,i)=>`campusWF0${i+1}phase1`),'campusAgentToolpersonal','campusAgentToolknowledge','campusAgentToolweb','campusNativeAgentV2'];
const credentialIds=['campus-task-synthetic','campus-demo-synthetic','campus-maintenance-synthetic','campus-knowledge-synthetic','campus-observability-synthetic','campus-webhook-synthetic'];
assert.equal(base,'http://localhost:15679');
const apply=process.argv.includes('--apply');
const api=await session(),workflows=await api('/workflows'),credentials=await api('/credentials');
const targets=workflows.filter(w=>workflowIds.includes(w.id));
const retained=workflows.filter(w=>!workflowIds.includes(w.id));
for(const workflow of retained){
 const graph=await api(`/workflows/${workflow.id}`);
 for(const node of graph.nodes){
  assert(!Object.values(node.credentials||{}).some(c=>credentialIds.includes(c.id)),`Retained workflow ${workflow.id} uses synthetic credentials`);
  assert(!String(node.parameters?.url||'').includes('mock-gateway'),`Retained workflow ${workflow.id} uses mock HTTP`);
 }
}
console.log(JSON.stringify({apply,workflows:targets.map(w=>({id:w.id,active:w.active})),credentials:credentials.filter(c=>credentialIds.includes(c.id)).map(c=>({id:c.id})),retained:retained.map(w=>({id:w.id,active:w.active}))}));
if(apply){
 const removed=[];
 for(const workflow of targets){
  if(workflow.active)await api(`/workflows/${workflow.id}/deactivate`,'POST');
  const current=await api(`/workflows/${workflow.id}`);
  if(!current.isArchived)await api(`/workflows/${workflow.id}/archive`,'POST');
  await api(`/workflows/${workflow.id}`,'DELETE');removed.push(workflow.id);
 }
 for(const credential of credentials.filter(c=>credentialIds.includes(c.id)))await api(`/credentials/${credential.id}`,'DELETE');
 const remaining=await api('/workflows'),remainingCredentials=await api('/credentials');
 assert(!remaining.some(w=>workflowIds.includes(w.id)));
 assert(!remainingCredentials.some(c=>credentialIds.includes(c.id)));
 for(const w of retained)assert(remaining.some(actual=>actual.id===w.id),'Unexpected workflow removal');
 writeFileSync('docs/verification/synthetic-runtime-cleanup.json',JSON.stringify({checkedAt:new Date().toISOString(),removedWorkflowIds:removed,removedCredentialIds:credentialIds.filter(id=>credentials.some(c=>c.id===id)),remainingWorkflowIds:remaining.map(w=>w.id),retainedTrueData:true,scope:'n8n synthetic workflows/credentials only; repository historical regression assets retained'},null,2)+'\n');
 console.log('Verified synthetic workflows and credentials removed; real/user workflows preserved.');
}
