import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {session,base} from './n8n-client.mjs';

assert.equal(base,'http://localhost:15679','Only the verified local n8n instance is permitted');
const api=await session();

let source;
try{source=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));}
catch{throw new Error('Generated live workflow is missing or invalid; refusing to test or update.');}

console.log('Verifying workflow graph and tool nodes in campusNativeAgentLive...');
const toolNames=['student_schedule','student_absence','student_announcements','student_grades','student_leave','student_send_mail','official_search'];
for(const name of toolNames){
 const node=source.nodes.find(n=>n.name===name);
 assert(node,`Missing tool node: ${name}`);
 assert.equal(node.type,'n8n-nodes-base.httpRequestTool');
 assert(source.connections[name]?.ai_tool,`Tool ${name} is not connected to Agent ai_tool port`);
}

const live=await api('/workflows/campusNativeAgentLive');
assert.equal(live.id,'campusNativeAgentLive');

mkdirSync('.local',{recursive:true});
writeFileSync('.local/extended-tools-workflow-before.json',JSON.stringify(live),{mode:0o600});

console.log('Applying updated nodes and connections to campusNativeAgentLive on local n8n...');
const updated=await api(`/workflows/${source.id}`,'PATCH',{
 nodes:source.nodes,
 connections:source.connections,
 versionId:live.versionId,
});

if(live.active){
 await api(`/workflows/${source.id}/activate`,'POST',{versionId:updated.versionId});
}

const actual=await api(`/workflows/${source.id}`);
assert.equal(actual.active,live.active);
assert.equal(actual.nodes.length,source.nodes.length);
for(const name of toolNames){
 const node=actual.nodes.find(n=>n.name===name);
 assert(node,`Tool node ${name} missing after update`);
}
console.log('Successfully updated campusNativeAgentLive on local n8n runtime with all 7 tools connected!');

const report={
 recordedAt:new Date().toISOString(),
 workflowId:source.id,
 versionId:actual.versionId,
 active:actual.active,
 toolCount:toolNames.length,
 tools:toolNames,
 status:'pass',
};
writeFileSync('docs/verification/extended-tools-runtime.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
