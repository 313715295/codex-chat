// Read-only publisher metadata bridge. Evaluate in functions.exec.
// Returns an allowlist; never saves provider tokens, auth clients, or credentials.
(() => {
  'use strict';
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const requireValue = (condition, code) => {
    if (!condition) throw Object.assign(new Error(code), {code});
  };
  const endpoint = value => typeof value === 'string' &&
    /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\/mcp$/.test(value);
  function unpack(value) {
    for (let i = 0; i < 6; i++) {
      requireValue(object(value) && !value.isError, 'PUBLISHER_METADATA_ACCESS_FAILED');
      if (typeof value.id === 'string') return value;
      if (object(value.structuredContent)) {value = value.structuredContent; continue;}
      const texts = value.content?.filter(item => item.type === 'text');
      requireValue(texts?.length === 1, 'PUBLISHER_METADATA_UNREADABLE');
      try {value = JSON.parse(texts[0].text);} catch {requireValue(false, 'PUBLISHER_METADATA_UNREADABLE');}
    }
    requireValue(false, 'PUBLISHER_METADATA_UNREADABLE');
  }
  function connectionFromSite(site, {projectId, expectedMcpUrl}) {
    requireValue(endpoint(expectedMcpUrl), 'EXACT_RESULTS_MCP_URL_REQUIRED');
    requireValue(site.id === projectId, 'PUBLISHER_PROJECT_MISMATCH');
    requireValue(['owner', 'editor'].includes(site.current_user_role), 'PUBLISHER_ROLE_REQUIRED');
    requireValue(site.status === 'active' && typeof site.current_live_url === 'string' &&
      site.current_live_url.replace(/\/$/, '') + '/mcp' === expectedMcpUrl, 'PUBLISHED_RESULTS_SERVICE_MISMATCH');
    const mcp = site.mcp_connection;
    requireValue(object(mcp) && mcp.mcp_url === expectedMcpUrl &&
      mcp.oauth_resource === expectedMcpUrl, 'REGISTERED_RESULTS_CONNECTION_NOT_READY');
    requireValue(typeof mcp.plugin_id === 'string' &&
      /^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(mcp.plugin_id), 'REGISTERED_RESULTS_MCP_ID_REQUIRED');
    return {
      schemaVersion: 1,
      source: 'openai-sites:get_site',
      projectId,
      siteRole: site.current_user_role,
      registeredMcpId: mcp.plugin_id,
      mcpUrl: mcp.mcp_url,
      oauthResource: mcp.oauth_resource
    };
  }
  async function inspectResultConnection(hosting, getSite, {expectedMcpUrl} = {}) {
    try {
      const projectId = hosting?.project_id;
      requireValue(typeof projectId === 'string' && projectId.length > 0 &&
        projectId.length <= 256 && !/[\x00-\x20\x7f]/.test(projectId), 'PUBLISHER_PROJECT_ID_REQUIRED');
      requireValue(endpoint(expectedMcpUrl), 'EXACT_RESULTS_MCP_URL_REQUIRED');
      requireValue(typeof getSite === 'function', 'PUBLISHER_METADATA_TOOL_REQUIRED');
      const site = unpack(await getSite({project_id: projectId, include_mcp_connection: true}));
      return {status: 'ready_to_package', connection: connectionFromSite(site, {projectId, expectedMcpUrl}),
        accountConnected: false, crossAccountAccessVerified: false, permissionsChanged: false};
    } catch (error) {
      return {status: 'blocked', errorCode: error.code ?? 'PUBLISHER_METADATA_FAILED',
        accountConnected: false, permissionsChanged: false};
    }
  }
  return {inspectResultConnection, connectionFromSite};
})()
