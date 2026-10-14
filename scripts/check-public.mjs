import {readdir,readFile,lstat} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ignored=new Set(['.git','node_modules','.release-work','downloads','.wrangler','.sites-runtime','.vinext','.next','dist']);
const forbidden=/^(bindings|collaboration|RESULTS-CONNECTION|results-connection|own-results-setup|INSTALLATION)\.json$|\.state\.json$|\.(pem|key|pfx|p12)$/i;
const secrets=[/gh[pousr]_[A-Za-z0-9]{30,}/,/github_pat_[A-Za-z0-9_]{30,}/,/sk-(?:proj-)?[A-Za-z0-9_-]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const personal=[/appgprj_[a-f0-9]{24,}/,/plugin_asdk_app_sites_[a-f0-9]{24,}/,/https:\/\/[a-z0-9.-]+\.chatgpt\.site(?:\/|\b)/i,/[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9_-]+[\\/]/];
let count=0;const problems=[];
async function scan(folder){
 for(const entry of await readdir(folder,{withFileTypes:true})){
  if(ignored.has(entry.name))continue;
  const p=join(folder,entry.name),label=p.slice(root.length+1).replaceAll('\\','/');
  if(entry.isSymbolicLink()){problems.push(label+': link');continue;}
  if(entry.isDirectory()){await scan(p);continue;}
  if(!entry.isFile())continue;count++;
  if(forbidden.test(entry.name)||entry.name.startsWith('.env')&&entry.name!=='.env.example')problems.push(label+': private file');
  const body=await readFile(p,'utf8');
  if(secrets.some(r=>r.test(body)))problems.push(label+': credential pattern');
  if(personal.some(r=>r.test(body)))problems.push(label+': personal identity');
 }
}
await scan(root);
const hosting=JSON.parse(await readFile(join(root,'source/results-attachments-template/.openai/hosting.json'),'utf8'));
if(hosting.project_id||hosting.d1!=='DB'||hosting.r2!=='BUCKET')problems.push('hosting: not clean');
if(problems.length){console.error(JSON.stringify({status:'failed',problems}));process.exitCode=1;}else console.log(JSON.stringify({status:'passed',scannedFiles:count,personalConfigurationIncluded:false}));
