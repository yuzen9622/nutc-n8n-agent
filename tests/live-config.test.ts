import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../apps/gateway/src/config/env.js';
const base={APP_MODE:'live',LINE_DESTINATION:`U${'a'.repeat(32)}`,LINE_LOGIN_CHANNEL_ID:'2011885607',
  LINE_CHANNEL_SECRET:'test-line-secret',LINE_ACCESS_TOKEN:'test-access',SESSION_SECRET:'s'.repeat(40),SERVICE_TOKEN:'t'.repeat(40),DATABASE_URL:'postgresql://test'};
test('live config supports direct env secrets and keeps paid attempts disabled by default',()=>{
  const result=loadConfig(base);
  assert.equal(result.channelId,'2011885607'); assert.equal(result.channelSecret,base.LINE_CHANNEL_SECRET);
  assert.equal(result.totalBudgetMicroUsd,0); assert.equal(result.enabled,false);
  assert.throws(()=>loadConfig({...base,LINE_CHANNEL_SECRET:undefined}),/LINE_CHANNEL_SECRET_REQUIRED/);
  assert.throws(()=>loadConfig({...base,LINE_CHANNEL_SECRET_FILE:'/must-not-read'}),/Use LINE_CHANNEL_SECRET in .env/);
  assert.throws(()=>loadConfig({...base,SERVICE_TOKEN:base.SESSION_SECRET}),/INVALID_SERVICE_TOKEN/);
});
test('LIFF config requires the correct login channel and a bare HTTPS origin',()=>{
  const setup={...base,PUBLIC_ORIGIN:'https://campus.example',LIFF_ID:'2011885607-test'};
  assert.equal(loadConfig(setup).publicOrigin,setup.PUBLIC_ORIGIN);
  assert.throws(()=>loadConfig({...setup,LIFF_ID:'2011885580-test'}),/CHANNEL_MISMATCH/);
  for(const PUBLIC_ORIGIN of ['http://campus.example','https://campus.example/','https://campus.example/liff/','https://user:password@campus.example']){
    assert.throws(()=>loadConfig({...setup,PUBLIC_ORIGIN}),/INVALID_PUBLIC_ORIGIN/);
  }
});
