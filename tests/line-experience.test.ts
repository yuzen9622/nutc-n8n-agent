import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LineProvider} from '../apps/gateway/src/modules/line/line.provider.js';
import {TaskWorker} from '../apps/gateway/src/modules/tasks/task.worker.js';

const user=`U${'a'.repeat(32)}`, key='e7f2928d-1d28-40ab-9684-79cb74f781ae';
const task={id:key,userId:user,generation:'0',prompt:'課表',lease:key,capability:'a'.repeat(43)};

test('LINE provider sends official bounded loading request, not a chat message',async()=>{
  const provider=new LineProvider('123','access',async(url,options)=>{
    assert.equal(url,'https://api.line.me/v2/bot/chat/loading/start');
    assert.equal(options?.method,'POST');assert.equal(options?.redirect,'error');
    assert.equal((options?.headers as Record<string,string>).authorization,'Bearer access');
    assert.deepEqual(JSON.parse(String(options?.body)),{chatId:user,loadingSeconds:60});
    assert(options?.signal);return new Response('{}',{status:202});
  });
  await provider.startLoading(user);
  await assert.rejects(provider.startLoading('group-id'));
  await assert.rejects(new LineProvider('123','access',async()=>new Response(null,{status:429})).startLoading(user));
});

test('claimed worker starts loading before dispatch; loading failure does not fail task',async()=>{
  for(const fails of [false,true]){
    const actions:string[]=[];let current:typeof task|null=task;
    const worker=new TaskWorker({claim:async()=>current,fail:async()=>{actions.push('fail');},deliverOne:async()=>false,cleanup:async()=>{}},
      async()=>{actions.push('dispatch');},async()=>{},()=>{actions.push('error');},1000,
      async(id)=>{assert.equal(id,user);actions.push('loading');if(fails)throw Error('unavailable');});
    assert.equal(await worker.tick(),true);
    assert.deepEqual(actions,fails?['loading','error','dispatch']:['loading','dispatch']);
    current=null;actions.length=0;assert.equal(await worker.tick(),false);assert.deepEqual(actions,[]);
  }
});

test('LINE dispatch converts Markdown to plain text, preserving links and literal text',async()=>{
  const requests:string[]=[];
  const provider=new LineProvider('123','access',async(_url,options)=>{
    requests.push(JSON.parse(String(options?.body)).messages[0].text);return new Response('{}');
  });
  await provider.push(user,'## 明天課表\n- **程式設計**：`A_101`\n> 請準時\n[學校](https://school.example/a_b?x=1&y=2)\n一般 foo_bar_baz 與 2 * 3',key);
  assert.equal(requests[0],'明天課表\n• 程式設計：A_101\n請準時\n學校（https://school.example/a_b?x=1&y=2）\n一般 foo_bar_baz 與 2 * 3');
  await provider.push(user,'**粗體**、*斜體*、_強調_、~~刪除~~\n```text\nfoo_bar **literal**\n```\nhttps://school.example/a_b?wild=*',key);
  assert.equal(requests[1],'粗體、斜體、強調、刪除\nfoo_bar **literal**\nhttps://school.example/a_b?wild=*');
  await provider.push(user,'| 時間 | 課程 |\n| --- | --- |\n| 08:00 | **程式** |',key);
  assert.equal(requests[2],'時間　課程\n08:00　程式');
  await provider.push(user,'```text\n# TODO\n| one | two |\n**literal**\n```',key);
  assert.equal(requests[3],'# TODO\n| one | two |\n**literal**');
  await provider.push(user,'班級代號 #\n## 標題 ##\n**https://school.example/a_b**',key);
  assert.equal(requests[4],'班級代號 #\n標題\nhttps://school.example/a_b');
  await assert.rejects(provider.push(user,'** **',key));
});

test('live Agent uses a dynamic authoritative Taiwan clock and LINE text instructions',()=>{
  const workflow=JSON.parse(readFileSync('workflows/agent/campusNativeAgentLive.json','utf8'));
  const prompt=workflow.nodes.find((n:{id:string})=>n.id==='agent').parameters.options.systemMessage;
  assert.match(prompt,/^=/);assert.match(prompt,/\$now\.setZone\('Asia\/Taipei'\)/);
  assert.match(prompt,/yyyy-MM-dd/);assert.match(prompt,/HH:mm:ss/);assert.match(prompt,/cccc/);
  assert.match(prompt,/UTC\+08:00/);assert.match(prompt,/今天.*明天/);
  assert.match(prompt,/純文字/);assert.match(prompt,/Markdown/);
});
