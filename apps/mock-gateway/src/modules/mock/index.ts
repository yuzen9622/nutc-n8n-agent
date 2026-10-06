import type { Config } from '../../config/env.js';
import { MockService } from './mock.service.js';
import { createController } from './mock.controller.js';
import { createRouter } from './mock.router.js';
export function registerMockModule(config:Config,service=new MockService()) {return createRouter(config,createController(service));}
