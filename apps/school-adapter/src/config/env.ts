import {z} from 'zod';
export function loadSchoolConfig(env:NodeJS.ProcessEnv=process.env){
 const values=z.object({SCHOOL_HOST:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),SCHOOL_PORT:z.coerce.number().int().min(1).max(65535).default(3200),SCHOOL_DATABASE_URL:z.string().min(1),SCHOOL_SERVICE_TOKEN:z.string().min(32),SCHOOL_SESSION_KEY:z.string().regex(/^[a-f0-9]{64}$/i),SCHOOL_ACCOUNT_HASH_KEY:z.string().min(32)}).parse(env);
 if(new Set([values.SCHOOL_SERVICE_TOKEN,values.SCHOOL_SESSION_KEY,values.SCHOOL_ACCOUNT_HASH_KEY,env.SERVICE_TOKEN,env.SESSION_SECRET].filter(Boolean)).size!==[values.SCHOOL_SERVICE_TOKEN,values.SCHOOL_SESSION_KEY,values.SCHOOL_ACCOUNT_HASH_KEY,env.SERVICE_TOKEN,env.SESSION_SECRET].filter(Boolean).length)throw Error('SCHOOL_SECRETS_MUST_BE_DISTINCT');
 return values;
}
