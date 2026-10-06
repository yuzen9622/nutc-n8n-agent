import type { IncomingMessage,ServerResponse } from 'node:http';
import type { GeminiProvider } from './gemini.provider.js';
import { readRaw } from '../../utils/http.js';
export class GeminiController {
  constructor(private readonly provider:GeminiProvider) {}
  async relay(req:IncomingMessage,res:ServerResponse) {
    const key=req.headers['x-goog-api-key'];
    const result=await this.provider.relay(req.url??'',typeof key==='string'?key:undefined,await readRaw(req));
    res.writeHead(result.status,{'content-type':result.contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(result.body);
  }
}
