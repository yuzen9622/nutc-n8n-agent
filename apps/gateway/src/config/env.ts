import { z } from 'zod';
import { runtimeEnv } from '../../../shared/runtime-config.mjs';

export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const env = runtimeEnv(input);
  const schema = z.object({
    SCHOOL_ORIGIN:z.enum(['http://127.0.0.1:3200','http://school-adapter:3200']).optional(), SCHOOL_SERVICE_TOKEN:z.string().min(32).optional(),
    PUBLIC_ORIGIN:z.url().optional(), LIFF_ID:z.string().regex(/^\d+-[A-Za-z0-9]+$/).optional(),
    APP_MODE: z.literal('live'), HOST:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),
    N8N_WEBHOOK_URL:z.url(), N8N_WEBHOOK_TOKEN:z.string().min(1),
    SERVICE_TOKEN:z.string().min(1).optional(), PORT: z.coerce.number().int().min(1).max(65535).default(3100),
    LINE_MESSAGING_CHANNEL_ID:z.string().regex(/^\d+$/).optional(),
    LINE_LOGIN_CHANNEL_ID: z.string().regex(/^\d+$/),
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
  const schoolToken=secret('SCHOOL_SERVICE_TOKEN',false);
  if(values.SCHOOL_ORIGIN && !schoolToken)throw new Error('SCHOOL_CONFIGURATION_INCOMPLETE');
  if(schoolToken && [serviceToken,sessionSecret,webhookToken].includes(schoolToken))throw new Error('INVALID_SCHOOL_TOKEN');
  return { school:values.SCHOOL_ORIGIN?{origin:values.SCHOOL_ORIGIN,token:schoolToken!}:undefined,publicOrigin,liffId:values.LIFF_ID,host:values.HOST, serviceToken, webhookUrl:values.N8N_WEBHOOK_URL,webhookToken,port: values.PORT, channelId: values.LINE_LOGIN_CHANNEL_ID,
    channelSecret: secret('LINE_CHANNEL_SECRET')!, accessToken: secret('LINE_ACCESS_TOKEN')!,
    sessionSecret, databaseUrl: secret('DATABASE_URL')! };
}
