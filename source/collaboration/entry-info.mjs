// Local read-only discovery. Runs without an installed skill or platform credentials.
import {readFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const scriptRoot=dirname(fileURLToPath(import.meta.url)),packageRoot=resolve(scriptRoot,'../..');
export async function entryInfo({hostBundle=false}={}){
  const entrySource=await readFile(join(scriptRoot,'job-entry.js'),'utf8');
  const entry=new Function('return (\n'+entrySource+'\n)')();
  const info={...entry.describe(),version:'0.3.13',skillRequired:false,scriptRoot,packageRoot,
    guides:{requests:join(packageRoot,'docs/codex/requests.md'),setup:join(packageRoot,'docs/codex/own-results-setup.md'),host:join(packageRoot,'docs/codex/host-entry.md')}};
  return hostBundle?{info,entrySource}:info;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length>3||process.argv[2]&&!['--host-bundle'].includes(process.argv[2]))throw new Error('UNKNOWN_ENTRY_OPTION');
  entryInfo({hostBundle:process.argv[2]==='--host-bundle'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
