import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const files=readdirSync('workflows').filter(x=>/^WF-/.test(x));assert.equal(files.length,7);
const workflows=files.map(f=>JSON.parse(readFileSync(`workflows/${f}`)));const ids=new Set(workflows.map(w=>w.id));
for(const w of workflows) {
 const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
 for(const [source,ports]of Object.entries(w.connections)){assert(names.has(source));for(const output of ports.main)for(const target of output)assert(names.has(target.node),`dangling ${target.node}`);}
 for(const n of w.nodes){if(n.type.endsWith('.executeWorkflow'))assert(ids.has(n.parameters.workflowId.value));if(n.type.endsWith('.switch'))assert.equal(n.parameters.options.fallbackOutput,'extra');if(n.type.endsWith('.httpRequest')){assert.equal(n.retryOnFail,false);assert(n.credentials.httpHeaderAuth);}}
 assert.equal(w.active,false);assert.deepEqual(w.pinData,{});
}
// Small dependency-direction gate, no global mocking of the actual service behavior.
const root='apps/mock-gateway/src/modules/mock/';
const router=readFileSync(root+'mock.router.ts','utf8');assert(!/from ['"].*(service|repository)\.js/.test(router));
const service=readFileSync(root+'mock.service.ts','utf8');assert(!/from ['"].*(controller|router|node:http)/.test(service));assert(!/\bfetch\s*\(/.test(service));
for(const f of ['SDD.md','WORKFLOWS.md','ROADMAP.md','RAG.md']) {
 const md=readFileSync(`docs/${f}`,'utf8');for(const m of md.matchAll(/\]\(([^)]+\.md)(?:#[^)]*)?\)/g)){if(!m[1].includes('://'))readFileSync(new URL(m[1],new URL(`../docs/${f}`,import.meta.url)));}
}
console.log('7 workflow graphs, references, fallback switches, layer boundaries and Phase 0 document links passed.');
