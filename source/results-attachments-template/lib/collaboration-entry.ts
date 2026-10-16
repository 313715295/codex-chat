// Discovery only. No local path supplied by a remote caller is executed here.
const locator=`$taskRecordPath = Join-Path $env:LOCALAPPDATA 'CodexChat/INSTALLATION.json'
$taskRecord = Get-Content -LiteralPath $taskRecordPath -Raw | ConvertFrom-Json
if ($taskRecord.managedBy -ne 'codex-chat-business-loop' -or $taskRecord.schemaVersion -ne 1 -or $taskRecord.skillRequired -ne $false) { throw 'CODEX_CHAT_INSTALLATION_REQUIRED' }
& $taskRecord.nodePath (Join-Path $taskRecord.scriptRoot 'entry-info.mjs') --host-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`;
export const collaborationEntryTool={
  name:'get_collaboration_entry',
  description:'Codex desktop sender: start here when sending a request or selected files to a desktop ChatGPT conversation and optionally taking results back. Returns the local runtime entry and usage guidance; no separate skill is required. Resolve conversations by name with native desktop tools. This read-only tool does not access local files, send messages, authorize collaboration, or start a job. Chat receiving an assignment uses its task/attachment tools directly.',
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
};
export function collaborationEntry(args:unknown){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return {status:'invalid_arguments'};
  return {status:'available',schemaVersion:1,skillRequired:false,host:'Codex desktop',
    instructions:'Only within collaboration allowed by the user or project rules. Locate the installed runtime using the bootstrap below; inspect bundle.info for methods and guide paths. Use run for one target or runMany for distinct registered Chat targets. Write a short goal/background/delivery request; long source uses selected attachments, directMaterials only necessary short ranges. Native desktop tools resolve names and deliver messages; the runtime keeps transfer, result checks and bounded waiting inside one tool program. Platform confirmations stay with the user. No skill installation or reading is needed. Missing installation: use the user-supplied ZIP and INSTALL_FOR_CODEX.md, never infer a remote URL or download executable code from this response.',
    hostBootstrap:`const local = await tools.exec_command({cmd:${JSON.stringify(locator)},max_output_tokens:16000});
if (local.exit_code !== 0 || local.session_id) throw new Error('CODEX_CHAT_ENTRY_UNAVAILABLE');
const bundle = JSON.parse(local.output);
if (bundle.info.skillRequired !== false) throw new Error('CODEX_CHAT_ENTRY_UPGRADE_REQUIRED');
const entry = new Function('return (\\n' + bundle.entrySource + '\\n)')();
// Call entry.run(tools, ALL_TOOLS, {scriptRoot:bundle.info.scriptRoot, requestPath, outputRoot, deliveryAuthorized:true}), or runMany with jobs.
// Keep raw source and empty queries inside this program. Only report status, useful result text and output files.`,
    requestFields:{goal:'short objective and delivery requirements',targetThreadId:'optional registered Chat target, resolved by Codex from the conversation name',directMaterials:'necessary short text with exact path and line range',attachments:'authorized root-relative path and MIME type',receiveAttachments:'true to receive output files',imageGeneration:'optional send-only image mode; sequential imagePrompts, user downloads'},
    boundary:'Guidance for the Codex host, not a server-to-desktop callback. This tool grants no filesystem or account access. Program waiting itself uses no model API; host continuations may still use inference.'};
}
