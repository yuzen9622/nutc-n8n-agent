import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Fault } from '../../utils/fault.js';
import { userIdSchema } from './line.schema.js';
import { linePlainText } from './line.text.js';

export function verifySignature(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

const identity = z.object({ iss: z.literal('https://access.line.me'), sub: userIdSchema,
  aud: z.string(), exp: z.number().int(), iat: z.number().int() });
export class LineProvider {
  constructor(private readonly channelId: string, private readonly accessToken: string,
    private readonly request: typeof fetch = fetch) {}
  async verifyIdentity(idToken: string): Promise<string> {
    const response = await this.request('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: this.channelId }),
    });
    if (!response.ok) throw new Fault(response.status >= 500 || response.status === 429 ? 503 : 401, 'IDENTITY_UNAVAILABLE');
    const parsed = identity.safeParse(await response.json());
    const now = Math.floor(Date.now() / 1000);
    if (!parsed.success || parsed.data.aud !== this.channelId || parsed.data.exp <= now || parsed.data.iat > now + 60)
      throw new Fault(401, 'IDENTITY_DENIED');
    return parsed.data.sub;
  }
  async startLoading(userId:string):Promise<void> {
    userIdSchema.parse(userId);
    const response=await this.request('https://api.line.me/v2/bot/chat/loading/start',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(1500),
      headers:{authorization:`Bearer ${this.accessToken}`,'content-type':'application/json'},
      body:JSON.stringify({chatId:userId,loadingSeconds:60}),
    });
    if(!response.ok)throw new Fault(503,'LOADING_UNAVAILABLE');
  }
  async push(userId: string, text: string, retryKey: string): Promise<void> {
    userIdSchema.parse(userId);
    if (!text || text.length > 5000 || !z.uuid().safeParse(retryKey).success) throw new Fault(400, 'INVALID_REPLY');
    text=linePlainText(text);
    if(!text || text.length>5000)throw new Fault(400,'INVALID_REPLY');
    const response = await this.request('https://api.line.me/v2/bot/message/push', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json', 'X-Line-Retry-Key': retryKey },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
    });
    if (response.ok || (response.status === 409 && response.headers.has('x-line-accepted-request-id'))) return;
    throw new Fault(response.status === 429 || response.status >= 500 ? 503 : 422, 'DELIVERY_FAILED');
  }
}
