import {hkdfSync} from 'node:crypto';

const purposes={
  SESSION_SECRET:'session',
  SERVICE_TOKEN:'gateway-service',
  N8N_WEBHOOK_TOKEN:'n8n-webhook',
  SCHOOL_SERVICE_TOKEN:'school-service',
  SCHOOL_SESSION_KEY:'school-session',
  SCHOOL_ACCOUNT_HASH_KEY:'school-account-hash',
};

// Shared by both services and n8n bootstrap. Do not change these labels: persisted
// ciphertext and identity hashes depend on them. Old deployments must migrate
// deliberately; never silently replace their independently generated keys.
export function runtimeEnv(env){
  if(env.APP_MASTER_KEY===undefined)throw new Error('APP_MASTER_KEY_REQUIRED');
  if(!/^[a-f0-9]{64}$/i.test(env.APP_MASTER_KEY))throw new Error('APP_MASTER_KEY_INVALID');
  if(Object.keys(purposes).some(name=>env[name]))throw new Error('LEGACY_APP_SECRETS_PRESENT');
  if(['DATABASE_URL','SCHOOL_DATABASE_URL','AGENT_DB_PASSWORD'].some(name=>env[name]))throw new Error('LEGACY_DATABASE_CONFIG_PRESENT');
  if(!env.POSTGRES_PASSWORD)throw new Error('POSTGRES_PASSWORD_REQUIRED');
  const result={...env};
  const key=Buffer.from(env.APP_MASTER_KEY,'hex');
  for(const [name,purpose] of Object.entries(purposes)){
    result[name]=Buffer.from(hkdfSync('sha256',key,'campus-agent:v1',purpose,32)).toString('hex');
  }
  result.DATABASE_URL=`postgresql://campus_agent:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/campus_agent`;
  result.SCHOOL_DATABASE_URL=result.DATABASE_URL;
  result.N8N_WEBHOOK_URL=env.N8N_WEBHOOK_URL||'http://n8n:5678/webhook/campus-agent-live';
  return result;
}
