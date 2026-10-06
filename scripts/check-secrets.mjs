import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const secrets=existsSync('.local/secrets')?readdirSync('.local/secrets').map(f=>readFileSync(`.local/secrets/${f}`,'utf8').trim()):[];
if(existsSync('.local/owner.json'))secrets.push(JSON.parse(readFileSync('.local/owner.json')).password);
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){const content=readFileSync(file);if(secrets.some(s=>s&&content.includes(Buffer.from(s))))throw new Error(`Generated secret leaked into ${file}`);}
console.log(`Checked ${files.length} Git-visible files: no generated service/admin secrets.`);
