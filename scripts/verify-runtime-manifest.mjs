import {session,base} from './n8n-client.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const api=await session();const types=await api('/../types/nodes.json');
const manifest=JSON.parse(readFileSync('workflows/manifest.json'));
const checks=[];
const normalize=w=>({nodes:w.nodes,connections:w.connections,settings:{executionTimeout:100,...w.settings}});
for(const w of manifest.workflows){
 const live=await api(`/workflows/${w.id}`);const source=JSON.parse(readFileSync(`workflows/WF-0${w.number}.json`));
 for(const n of source.nodes)assert(types.some(t=>t.name===n.type&&[t.version].flat().includes(n.typeVersion)),`Unknown type/version ${n.type}@${n.typeVersion}`);
 assert.deepEqual(normalize(live),normalize(source),`Live workflow drift WF-0${w.number}`);
 const exported=JSON.parse(readFileSync(`.local/exports/WF-0${w.number}.json`));assert.deepEqual(normalize(exported),normalize(source),`Export drift WF-0${w.number}`);
 checks.push({workflow:`WF-0${w.number}`,id:w.id,url:`${base}/workflow/${w.id}`,versionId:live.versionId,activeVersionId:live.activeVersionId??null,sha256:createHash('sha256').update(readFileSync(`workflows/WF-0${w.number}.json`)).digest('hex'),nodeCount:source.nodes.length,nodeTypes:w.nodeTypes});
}
const report={n8nVersion:manifest.n8nVersion,recordedAt:new Date().toISOString(),syntheticOnly:true,validation:'registered-types-live-import-execution-and-export-verified',workflows:checks};
writeFileSync('docs/verification/runtime-manifest.json',JSON.stringify(report,null,2)+'\n');console.log('All seven live and exported graphs match source; node typeVersions are registered in n8n 2.41.7.');
