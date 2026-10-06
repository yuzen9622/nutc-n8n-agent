import type { IncomingMessage, ServerResponse } from 'node:http';
import { Fault } from './fault.js';

export async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const part of req) {
    const chunk = Buffer.from(part); length += chunk.length;
    if (length > 256 * 1024) throw new Fault(413,'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(JSON.stringify(body));
}
