import { readFileSync } from 'node:fs';
import { z } from 'zod';
const schema = z.object({ APP_MODE: z.literal('synthetic'), PORT: z.coerce.number().int().min(1).max(65535).default(3000) });
export type Scope = 'task' | 'demo' | 'maintenance' | 'knowledge' | 'observability';
export type Config = { mode: 'synthetic'; port: number; tokens: Record<Scope,string> };
export function loadConfig(env = process.env): Config {
  const parsed = schema.parse(env);
  const tokens = Object.fromEntries(['task','demo','maintenance','knowledge','observability'].map(scope => {
    const key = `MOCK_${scope.toUpperCase()}_TOKEN`;
    const token = env[`${key}_FILE`] ? readFileSync(env[`${key}_FILE`]!, 'utf8').trim() : env[key];
    if (!token || token.length < 32) throw new Error(`Missing ${key} (minimum 32 characters)`);
    return [scope, token];
  })) as Config['tokens'];
  if (new Set(Object.values(tokens)).size !== 5) throw new Error('Service tokens must be distinct');
  return {mode: parsed.APP_MODE, port: parsed.PORT, tokens};
}
