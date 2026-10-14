// Validate the credential-free, host-generated publisher reference.
// This is packaging validation, not proof of consumer account access.
import {readFile, stat} from 'node:fs/promises';
const keys = ['schemaVersion', 'source', 'projectId', 'siteRole', 'registeredMcpId', 'mcpUrl', 'oauthResource'];
const insist = (condition, code) => {if (!condition) throw new Error(code);};
export function validateResultConnection(input) {
  const selectedKeys=input?.schemaVersion===2?[...keys,'accountId','principalId','toolPrefix']:keys;
  insist(input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length === selectedKeys.length && selectedKeys.every(key => Object.hasOwn(input, key)),
    'CREDENTIAL_FREE_RESULTS_REFERENCE_REQUIRED');
  insist([1,2].includes(input.schemaVersion) && input.source === 'openai-sites:get_site' &&
    ['owner', 'editor'].includes(input.siteRole), 'HOST_PUBLISHER_REFERENCE_REQUIRED');
  insist(typeof input.projectId === 'string' && input.projectId.length > 0 &&
    input.projectId.length <= 256 && !/[\x00-\x20\x7f]/.test(input.projectId), 'PUBLISHER_PROJECT_ID_REQUIRED');
  insist(typeof input.registeredMcpId === 'string' &&
    /^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(input.registeredMcpId), 'REGISTERED_RESULTS_MCP_ID_REQUIRED');
  const url = new URL(input.mcpUrl);
  insist(url.protocol === 'https:' && url.pathname === '/mcp' && !url.username && !url.password &&
    !url.search && !url.hash && url.href === input.mcpUrl &&
    !url.port && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) &&
    input.oauthResource === input.mcpUrl, 'EXACT_RESULTS_MCP_URL_REQUIRED');
  if(input.schemaVersion===2){
    insist(input.siteRole==='owner','OWN_ACCOUNT_OWNER_REQUIRED');
    for(const field of ['accountId','principalId'])insist(typeof input[field]==='string'&&input[field].length>0&&input[field].length<=256&&!/[\x00-\x20\x7f]/.test(input[field])&&!['__proto__','constructor','prototype'].includes(input[field]),'VERIFIED_ACCOUNT_IDENTITY_REQUIRED');
    insist(typeof input.toolPrefix==='string'&&/^mcp__[A-Za-z0-9_]+_$/.test(input.toolPrefix),'EXACT_SERVICE_TOOL_PREFIX_REQUIRED');
  }
  return Object.fromEntries(selectedKeys.map(key => [key, input[key]]));
}
export async function readResultConnection(path) {
  const file = await stat(path);
  insist(file.isFile() && file.size <= 16384, 'RESULTS_REFERENCE_TOO_LARGE');
  return validateResultConnection(JSON.parse(await readFile(path, 'utf8')));
}
