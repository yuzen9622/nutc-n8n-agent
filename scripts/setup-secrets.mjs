import {randomBytes} from 'node:crypto';
import {ensureEnv} from './env.mjs';
for(const name of ['POSTGRES_PASSWORD','DB_POSTGRESDB_PASSWORD','N8N_ENCRYPTION_KEY','AGENT_DB_PASSWORD',...['task','demo','maintenance','knowledge','observability','webhook'].map(s=>`MOCK_${s.toUpperCase()}_TOKEN`)])ensureEnv(name,()=>randomBytes(32).toString('hex'));
console.log('Synthetic secrets prepared in .env; existing values preserved, no values printed.');
