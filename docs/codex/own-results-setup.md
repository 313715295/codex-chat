# 本账号自有结果通道的首次初始化

只在需要首次安装或结果连接缺失时使用。每位用户独立拥有自己的私人服务；不连接框架作者或别人的后台，不从别人分享包复制 project_id、插件 ID、账号绑定或凭据。结果通道保存 external 任务元数据和结果；附件模式只短期保存当前授权任务的选定原文件，不存整个项目。

这是 Codex 宿主执行路径，不是一个脱离宿主后能调用账号工具的命令。先核对当前可用的原生 Sites 能力并读取已安装 Sites skill；缺少此能力就说明平台限制，不退回共享服务或让用户手填 OAuth 客户端。登录、安全确认仍由用户完成。项目身份与凭据遵守 Sites skill。

## 自动初始化

1. 在用户解压包的自有结果源码目录读取 .openai/hosting.json。附件版使用 source/results-attachments-template（D1=DB、R2=BUCKET），干净模板没有 project_id。既有自有源码的 ID 只在当前账号 owner 身份核实后复用；历史其他账号映射要保留并报告，不覆盖或拿来新建。第一次只把干净模板复制到新的本机可写 results-owned 目录，后续直接复用。
2. 用 source/collaboration/own-results-local.mjs 的 read 读取该自有源码目录的 hosting/state，加载 source/collaboration/own-results-runtime.js；ensureOwnResults 通过当前宿主原生 create_site、get_site、create_source_repository_write_credential、save_version_and_deploy_private 完成编排。io.checkpoint 与 io.persistHosting 分别调用本地 helper 的 checkpoint/hosting：第三参数仅是程序生成的非敏感 JSON 的 base64，hosting 只传返回的 project_id；不得传凭据。helper 原子写入并禁止替换已有项目。checkpoint 在变更之前写入，persistHosting 收到创建结果立即调用。状态显示 creating 而没有项目 ID 时，先核对原创建结果；不能再次 create。发布状态不明时先核对既有版本/部署，不能重复发布。
3. 新服务采用 owner-private。发布前 get_site 只读取元数据，不能指定 include_mcp_connection=true；发布成功后才索要连接信息。已有 ID 核对当前账号为 owner，并先确认私人受众。首次初始化授权覆盖本账号私人服务，不逐步骤问确认，不请求 publish-on-push 实验窗口。
4. syncSource 使用 Sites 官方 source helper 的真实 TTY：短期凭据只在内存，经隐藏 stdin 传入，不写文件、参数或日志。安装锁定依赖；Windows npm 启动器有路径问题时使用已核对的 npm JavaScript 入口。验证、构建并推送确切源码。本地 packager 缺 Bash 时，在确认源码已保存后，用 source/collaboration/pack-own-results.mjs <自有源码目录> <Sites插件根目录> <全新构建包路径> 打包同一提交；它调用官方 prepare-site-build.cjs，保留 dist 外层、hosting、归属信息和 migrations。不能本地打包才使用受支持的 remote-build fallback。
5. waitForDeployment 在工具程序内等待已有部署的终态，空状态不逐轮请求模型，不自动创建第二份服务；失败或安全拒绝就返回明确错误。
6. 加载 host-runtime.js，调用 connectAccount(tools, ALL_TOOLS, {projectId})，先探测实际工具与身份。返回 refresh_required 时，在下一次 functions.exec 中刷新工具清单并重查；仍缺连接时传 requestConnection:true，程序仅请求该 owner-private 服务的精确 plugin_id。把返回的 connectionAttempted 传给下一次调用，连接请求最多一次。包括 Already installed 在内的回执均需再刷新和探测，不能当作连接成功或重新建服务的理由。needs_connection 才引导本人到“插件 → 个人 → 由你创建”安装或连接该应用；先核实服务是否需要升级，不改审批设置。新会话恢复前核对已有安装记录，不重复建议安装已连接或正在等待确认的应用。
7. connected 返回的是原生 owner-private 记录和独立只读 MCP 探针核实的账号、服务内身份、固定地址及工具前缀。保存其白名单 connection，用 prepare.mjs account-register、account-bind 登记实际 Chat 和材料目录。配置按账号共存，不存 auth_client_id、token 或短期凭据。服务发布不等于连接完成，实际任务与 Chat 正式结果往返通过后才写完整安装验收通过。
8. 新连接须实际调用 get_collaboration_entry 并核对其引导可加载本机 entry-info.mjs；旧服务缺该工具时，按当前 owner-private 源码更新 MCP 路由和 lib/collaboration-entry.ts，不重建账号服务或存储。验证入口后，按 INSTALL_FOR_CODEX.md 自动退役旧协作 skill。
9. 以后启动时调用同一 ensureOwnResults，只查询已有 owner 项目并复用固定结果地址，不创建、安装依赖、推送或重新发布。任务正文仍走原生桌面消息。

## 手动协助

用户首选把 ZIP 附件或本机路径和安装目录交给 Codex，由 Codex 负责检查、解压和安装，再按本文初始化自己的私人结果通道；无需用户先解压或运行安装入口。手动解压保留为备用路径。Codex 处理这些步骤，登录或平台安全确认出现时只指出该页面上的必要动作。当前没有脱离 Codex 宿主的单命令账号发布器；缺少 Sites/插件连接能力时报告缺项，不要求用户猜测 clientId，也不能声称支持所有个人账户。
