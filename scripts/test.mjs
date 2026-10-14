import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const core=join(root,'source/collaboration'),backend=join(root,'source/results-attachments-template');
const suites=(await readdir(core)).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>join(core,n));
function run(args,cwd=root){const r=spawnSync(process.execPath,args,{cwd,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
run(['--test','--test-reporter=dot',...suites]);
run(['--test','--test-reporter=dot',join(backend,'tests/attachments.test.mjs')]);
run([join(backend,'tests/smoke.mjs')],backend);
