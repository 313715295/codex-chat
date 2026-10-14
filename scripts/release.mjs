import {mkdir,mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildFriendPackage} from '../source/collaboration/build-friend-package.mjs';
import {checkPackage} from '../source/collaboration/install-package.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
if(process.platform!=='win32')throw new Error('WINDOWS_PACKAGE_BUILD_REQUIRES_POWERSHELL');
const staging=join(root,'.release-work'),downloads=join(root,'downloads');
await mkdir(staging,{recursive:true});await mkdir(downloads,{recursive:true});
const work=await mkdtemp(join(staging,'package-')),directory=join(work,'package'),name='codex-chat-windows-x64-v'+version+'.zip',archive=join(downloads,name);
try{
 const built=await buildFriendPackage(directory),checked=await checkPackage(directory);
 const zipped=spawnSync('powershell.exe',['-NoProfile','-File',join(root,'scripts/zip-package.ps1'),'-Source',directory,'-Destination',archive],{stdio:'inherit'});
 if(zipped.error)throw zipped.error;if(zipped.status!==0)throw new Error('PACKAGE_ZIP_FAILED');
 const bytes=await readFile(archive),sha256=createHash('sha256').update(bytes).digest('hex');
 await writeFile(join(downloads,'SHA256SUMS.txt'),sha256+'  '+name+'\n');
 await writeFile(join(downloads,'manifest.json'),JSON.stringify({version,archive:name,sizeBytes:bytes.length,sha256,packageFiles:built.fileCount,verifiedFiles:checked.verifiedFiles,accountMappingIncluded:false,credentialsIncluded:false},null,2)+'\n');
 console.log(JSON.stringify({status:'built',...built,archive,sizeBytes:bytes.length,sha256,verifiedFiles:checked.verifiedFiles}));
}finally{
 const safeRoot=await realpath(staging),safeWork=await realpath(work);
 if(!safeWork.startsWith(safeRoot+sep)||safeWork===safeRoot)throw new Error('PACKAGE_CLEANUP_BOUNDARY');
 await rm(safeWork,{recursive:true,force:true});
}
