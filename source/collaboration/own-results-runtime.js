// Evaluate in functions.exec; native Sites tools own identity and publication.
// Credentials stay in memory and are passed only to the official source helper.
(() => {
  'use strict';
  const requireValue = (ok, code) => { if (!ok) throw Object.assign(new Error(code), {code}); };
  function unpack(value) {
    for (let i=0;i<6;i++) {
      requireValue(value && typeof value==='object' && !value.isError, 'PLATFORM_OPERATION_FAILED');
      if (value.id || value.token) return value;
      if (value.structuredContent) { value=value.structuredContent; continue; }
      const texts=value.content?.filter(c=>c.type==='text');
      requireValue(texts?.length===1,'PLATFORM_RESPONSE_UNREADABLE');
      try { value=JSON.parse(texts[0].text); } catch { requireValue(false,'PLATFORM_RESPONSE_UNREADABLE'); }
    }
    requireValue(false,'PLATFORM_RESPONSE_UNREADABLE');
  }
  function safeConnection(site, projectId) {
    requireValue(site.id===projectId && site.current_user_role==='owner','OWN_ACCOUNT_OWNER_REQUIRED');
    requireValue(site.status==='active' && /^https:\/\/[a-z0-9.-]+$/.test(site.current_live_url || ''),'RESULTS_NOT_PUBLISHED');
    const m=site.mcp_connection, url=site.current_live_url+'/mcp';
    requireValue(m && m.mcp_url===url && m.oauth_resource===url &&
      /^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(m.plugin_id || ''),'REGISTERED_RESULTS_NOT_READY');
    return {schemaVersion:1,source:'openai-sites:get_site',projectId,siteRole:'owner',
      registeredMcpId:m.plugin_id,mcpUrl:url,oauthResource:url};
  }
  async function ensureOwnResults(input, host, io) {
    requireValue(input && input.hosting && io && typeof io.checkpoint==='function' &&
      typeof io.persistHosting==='function','DURABLE_SETUP_STORAGE_REQUIRED');
    const stateKeys=['phase','projectId','ownerPrivateConfirmed','commitSha','deploymentId','versionId'];
    requireValue(Object.keys(input.state || {}).every(k=>stateKeys.includes(k)),'UNSAFE_SETUP_STATE');
    let hosting={...input.hosting}, state={...(input.state || {})}, credential;
    const save=async change => { state={...state,...change}; await io.checkpoint({...state}); };
    let projectId=hosting.project_id;
    if (state.projectId) requireValue(!projectId || state.projectId===projectId,'SETUP_PROJECT_MISMATCH');
    if (!projectId) {
      requireValue(!state.phase,'CREATION_OUTCOME_UNCERTAIN_DO_NOT_RECREATE');
      requireValue(input.setupAuthorized===true,'OWN_PRIVATE_SERVICE_SETUP_AUTHORIZATION_REQUIRED');
      requireValue(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*$/.test(input.slug || ''),'VALID_NEW_SERVICE_SLUG_REQUIRED');
      // An interrupted native create is reconciled, never blindly repeated.
      await save({phase:'creating'});
      const created=unpack(await host.create({slug:input.slug,title:'Codex Chat 结果通道',
        description:'本账号自有的私人协作通道；保存任务与结果，短期传输明确选定的授权原文件，不保存整个项目。',creation_intent:'user_requested'}));
      requireValue(typeof created.id==='string' && created.id.length>0,'CREATED_PROJECT_ID_REQUIRED');
      projectId=created.id;
      hosting={...hosting,project_id:projectId};
      await io.persistHosting(hosting); // Immediately; before any other platform call.
      await save({phase:'created',projectId,ownerPrivateConfirmed:true});
      credential=created.source_repository_credential;
    } else {
      requireValue(typeof projectId==='string' && projectId.length>0,'EXACT_EXISTING_PROJECT_ID_REQUIRED');
    }
    // An unpublished Site rejects MCP connection discovery. Read metadata first;
    // request connection details only after a successful publication exists.
    let site=unpack(await host.getSite({project_id:projectId,include_mcp_connection:false}));
    requireValue(site.id===projectId && site.current_user_role==='owner','OWN_ACCOUNT_OWNER_REQUIRED');
    requireValue(state.ownerPrivateConfirmed===true || input.ownerPrivateConfirmed===true,
      'PRIVATE_AUDIENCE_MUST_BE_CONFIRMED');
    // Reuse a published service. No dependency install, push, deploy, or new create.
    if (site.status==='active' && site.current_live_url) {
      site=unpack(await host.getSite({project_id:projectId,include_mcp_connection:true}));
      const connection=safeConnection(site,projectId);
      await save({phase:'ready',projectId,ownerPrivateConfirmed:true});
      return {status:'ready',connection,reused:true,accountConnectionVerified:false,permissionsChanged:false};
    }
    requireValue(state.ownerPrivateConfirmed===true || input.ownerPrivateConfirmed===true,
      'PRIVATE_AUDIENCE_MUST_BE_CONFIRMED');
    if (!state.deploymentId) {
      requireValue(!['syncing','publishing'].includes(state.phase),'PUBLICATION_OUTCOME_UNCERTAIN_RECONCILE_FIRST');
      requireValue(typeof io.syncSource==='function','SUPPORTED_SOURCE_HELPER_REQUIRED');
      credential ||= unpack(await host.credential({project_id:projectId}));
      requireValue(credential.publish_on_push_accepted!==true,'AUTO_PUBLICATION_WINDOW_RECONCILE_FIRST');
      await save({phase:'syncing',projectId,ownerPrivateConfirmed:true});
      const source=await io.syncSource({projectId,credential});
      credential=undefined;
      requireValue(source.project_id===projectId && /^[0-9a-f]{40}$/.test(source.commit_sha || ''),
        'EXACT_PUSHED_SOURCE_REQUIRED');
      await save({phase:'publishing',commitSha:source.commit_sha});
      const deployed=unpack(await host.publish({project_id:projectId,commit_sha:source.commit_sha,
        ...(source.archive?{archive:source.archive}:{})}));
      requireValue(deployed.project_id===projectId && deployed.id && deployed.version_id,
        'EXACT_DEPLOYMENT_ID_REQUIRED');
      await save({phase:deployed.status,projectId,deploymentId:deployed.id,versionId:deployed.version_id});
      if (deployed.status==='failed') throw Object.assign(new Error('PRIVATE_DEPLOYMENT_FAILED'),{code:'PRIVATE_DEPLOYMENT_FAILED'});
      if (deployed.status!=='succeeded') {
        requireValue(typeof io.waitForDeployment==='function','TOOL_PROGRAM_DEPLOYMENT_WAIT_REQUIRED');
        const final=await io.waitForDeployment({projectId,deploymentId:deployed.id});
        requireValue(final.project_id===projectId && final.id===deployed.id &&
          final.status==='succeeded','PRIVATE_DEPLOYMENT_NOT_SUCCEEDED');
      }
    } else {
      requireValue(typeof io.waitForDeployment==='function','TOOL_PROGRAM_DEPLOYMENT_WAIT_REQUIRED');
      const final=await io.waitForDeployment({projectId,deploymentId:state.deploymentId});
      requireValue(final.project_id===projectId && final.id===state.deploymentId &&
        final.status==='succeeded','PRIVATE_DEPLOYMENT_NOT_SUCCEEDED');
    }
    site=unpack(await host.getSite({project_id:projectId,include_mcp_connection:true}));
    const connection=safeConnection(site,projectId);
    await save({phase:'ready',projectId});
    return {status:'ready',connection,reused:false,accountConnectionVerified:false,permissionsChanged:false};
  }
  return {ensureOwnResults,safeConnection};
})()
