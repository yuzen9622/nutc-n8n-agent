import { createServer } from 'node:http';
import { loadConfig } from './config/env.js';
import { registerMockModule } from './modules/mock/index.js';
const config=loadConfig();
const server=createServer(registerMockModule(config));
server.requestTimeout=10_000;server.headersTimeout=10_000;
server.listen(config.port,'0.0.0.0',()=>console.log('Synthetic gateway ready'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
