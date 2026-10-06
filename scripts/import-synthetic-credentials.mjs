import {requiredEnv} from './env.mjs';
import {importCredentials} from './n8n-credentials.mjs';
const scopes=['task','demo','maintenance','knowledge','observability','webhook'];
importCredentials(scopes.map(scope=>({id:`campus-${scope}-synthetic`,name:`Campus synthetic ${scope}`,type:'httpHeaderAuth',data:{name:scope==='webhook'?'X-Campus-Webhook':'Authorization',value:(scope==='webhook'?'':'Bearer ')+requiredEnv(`MOCK_${scope.toUpperCase()}_TOKEN`)}})));
console.log('Synthetic credentials imported from .env through stdin.');
