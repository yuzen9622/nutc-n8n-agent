import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { userIdSchema } from '../modules/line/line.schema.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const schema = z.object({
    SCHOOL_ORIGIN:z.enum(['http://127.0.0.1:3200','http://school-adapter:3200']).optional(), SCHOOL_SERVICE_TOKEN:z.string().min(32).optional(),
    PUBLIC_ORIGIN:z.url().optional(), LIFF_ID:z.string().regex(/^\d+-[A-Za-z0-9]+$/).optional(),
    APP_MODE: z.literal('live'), HOST:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),
    N8N_WEBHOOK_URL:z.url(), N8N_WEBHOOK_TOKEN:z.string().min(1),
    SERVICE_TOKEN:z.string().min(1).optional(), PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    GEMINI_PROXY_TOKEN:z.string().min(1).optional(),GEMINI_CHAT_KEY:z.string().min(1).optional(),GEMINI_EMBEDDING_KEY:z.string().min(1).optional(),
    GEMINI_CHAT_MODEL:z.string().optional(),GEMINI_EMBEDDING_MODEL:z.string().optional(),
    GOOGLE_SEARCH_ENABLED:z.enum(['true','false']).default('false'),
    OFFICIAL_HOSTS_FILE:z.string().min(1).optional(),BRAVE_API_KEY:z.string().min(1).optional(),
    LINE_MESSAGING_CHANNEL_ID:z.string().regex(/^\d+$/).optional(),
    LINE_DESTINATION: userIdSchema, LINE_LOGIN_CHANNEL_ID: z.string().regex(/^\d+$/),
    LINE_CHANNEL_SECRET:z.string().min(1).optional(), LINE_ACCESS_TOKEN:z.string().min(1).optional(),
    SESSION_SECRET:z.string().min(1).optional(), DATABASE_URL:z.string().min(1).optional(),
  });
  const values = schema.parse(env);
  const secret = (name: string, required = true): string | undefined => {
    if (env[`${name}_FILE`]) throw new Error(`Use ${name} in .env`);
    const value = env[name];
    if (!value && required) throw new Error(`${name}_REQUIRED`);
    return value || undefined;
  };
  let publicOrigin: string | undefined;
  if (values.PUBLIC_ORIGIN || values.LIFF_ID) {
    if (!values.PUBLIC_ORIGIN || !values.LIFF_ID) throw new Error('LIFF_CONFIGURATION_INCOMPLETE');
    let origin:URL;
    try{origin=new URL(values.PUBLIC_ORIGIN);}catch{throw new Error('INVALID_PUBLIC_ORIGIN');}
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== values.PUBLIC_ORIGIN) throw new Error('INVALID_PUBLIC_ORIGIN');
    if (!values.LIFF_ID.startsWith(`${values.LINE_LOGIN_CHANNEL_ID}-`)) throw new Error('LIFF_CHANNEL_MISMATCH');
    publicOrigin = origin.origin;
  }
  const sessionSecret = secret('SESSION_SECRET')!;
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET_TOO_SHORT');
  const serviceToken=secret('SERVICE_TOKEN')!;
  if(serviceToken.length<32 || serviceToken===sessionSecret) throw new Error('INVALID_SERVICE_TOKEN');
  const webhookToken=secret('N8N_WEBHOOK_TOKEN')!;
  if(webhookToken.length<32 || [serviceToken,sessionSecret].includes(webhookToken)) throw new Error('INVALID_WEBHOOK_TOKEN');
  let hosts:string[]|undefined;
  if(values.OFFICIAL_HOSTS_FILE){
    try{hosts=z.array(z.string()).min(1).max(20).parse(JSON.parse(readFileSync(values.OFFICIAL_HOSTS_FILE,'utf8')));}
    catch{throw new Error('INVALID_OFFICIAL_HOSTS');}
  }
  if(Boolean(hosts)!==Boolean(values.BRAVE_API_KEY)) throw new Error('SEARCH_CONFIGURATION_INCOMPLETE');
  const braveKey=secret('BRAVE_API_KEY',false);
  let gemini;
  const geminiFields=[values.GEMINI_PROXY_TOKEN,values.GEMINI_CHAT_KEY,values.GEMINI_EMBEDDING_KEY,values.GEMINI_CHAT_MODEL,values.GEMINI_EMBEDDING_MODEL];
  if(geminiFields.some(Boolean)) {
    if(!geminiFields.every(Boolean)) throw new Error('GEMINI_PROXY_CONFIGURATION_INCOMPLETE');
    const token=secret('GEMINI_PROXY_TOKEN')!;
    if(token.length<32 || [serviceToken,sessionSecret,webhookToken].includes(token)) throw new Error('INVALID_GEMINI_PROXY_TOKEN');
    gemini={token,chatKey:secret('GEMINI_CHAT_KEY')!,embeddingKey:secret('GEMINI_EMBEDDING_KEY')!,
      chatModel:values.GEMINI_CHAT_MODEL!,embeddingModel:values.GEMINI_EMBEDDING_MODEL!};
  }
  if(values.GOOGLE_SEARCH_ENABLED==='true'&&(!gemini||!publicOrigin))throw new Error('GOOGLE_SEARCH_CONFIGURATION_INCOMPLETE');
  const grounding=values.GOOGLE_SEARCH_ENABLED==='true'?{key:gemini!.chatKey,model:gemini!.chatModel}:undefined;
  const schoolToken=secret('SCHOOL_SERVICE_TOKEN',false);
  if(values.SCHOOL_ORIGIN && !schoolToken)throw new Error('SCHOOL_CONFIGURATION_INCOMPLETE');
  if(schoolToken && [serviceToken,sessionSecret,webhookToken].includes(schoolToken))throw new Error('INVALID_SCHOOL_TOKEN');
  return { grounding,school:values.SCHOOL_ORIGIN?{origin:values.SCHOOL_ORIGIN,token:schoolToken!}:undefined,publicOrigin,liffId:values.LIFF_ID,gemini,hosts,braveKey,host:values.HOST, serviceToken, webhookUrl:values.N8N_WEBHOOK_URL,webhookToken,port: values.PORT, destination: values.LINE_DESTINATION, channelId: values.LINE_LOGIN_CHANNEL_ID,
    channelSecret: secret('LINE_CHANNEL_SECRET')!, accessToken: secret('LINE_ACCESS_TOKEN')!,
    sessionSecret, databaseUrl: secret('DATABASE_URL')! };
}
