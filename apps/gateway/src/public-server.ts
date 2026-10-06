import { createServer } from 'node:http';
import { z } from 'zod';
import { publicRouter } from './modules/ingress/public.router.js';
let origin: string;
try {
  origin = z.url().parse(process.env.PUBLIC_ORIGIN);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('INVALID_PUBLIC_ORIGIN');
} catch (e) {
  if (e instanceof Error && e.message === 'INVALID_PUBLIC_ORIGIN') throw e;
  throw new Error('INVALID_PUBLIC_ORIGIN');
}
const liffId = process.env.LIFF_ID;
if (liffId && (!/^\d+-[A-Za-z0-9]+$/.test(liffId) || !liffId.startsWith(`${process.env.LINE_LOGIN_CHANNEL_ID}-`))) {
  throw new Error('INVALID_LIFF_ID');
}
const server=createServer(publicRouter(origin,liffId));
server.requestTimeout=45000;server.headersTimeout=15000;
server.listen(3101,'127.0.0.1',()=>console.log('Public LINE/LIFF ingress ready on loopback port 3101'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();server.closeIdleConnections();});
