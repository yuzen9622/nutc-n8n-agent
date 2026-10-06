import {session} from './n8n-client.mjs';
const api=await session();
// n8n 2.41.7 requires published versions for nested sub-workflow execution.
for(const n of [2,3,4,1]) {
 const id=`campusWF0${n}phase1`,w=await api(`/workflows/${id}`);
 await api(`/workflows/${id}/activate`,'POST',{versionId:w.versionId});
 console.log(`Published ${id}`);
}
