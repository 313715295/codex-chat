# 本账号自有结果通道的首次初始化

只在需要首次安装或结果连接缺失时使用。每位用户独立拥有自己的私人服务；不连接框架作者或别人的后台，不从别人分享包复制 project_id、插件 ID、账号绑定或凭据。结果通道保存 external 任务元数据和结果；附件模式只短期保存当前授权任务的选定原文件，不存整个项目。

这是 Codex 宿主执行路径，不是一个脱离宿主后能调用账号工具的命令。先核对当前可用的原生 Sites 能力并读取已安装 Sites skill；缺少此能力就说明平台限制，不退回共享服务或让用户手填 OAuth 客户端。登录、安全确认仍由用户完成。项目身份与凭据遵守 Sites skill。

## 自动初始化

1. 在用户解压包的自有结果源码目录读取 .openai/hosting.json。附件版使用 source/results-attachments-template（D1=DB、R2=BUCKET），干净模板没有 project_id。既有自有源码的 ID 只在当前账号 owner 身份核实后复用；历史其他账号映射要保留并报告，不覆盖或拿来新建。第一次只把干净模板复制到新的本机可写 results-owned 目录，后续直接复用。
2. 用 scripts/own-results-local.mjs 的 read 读取该自有源码目录的 hosting/state，加载 scripts/own-results-runtime.js；ensureOwnResults 通过当前宿主原生 create_site、get_site、create_source_repository_write_credential、save_version_and_deploy_private 完成编排。io.checkpoint 与 io.persistHosting 分别调用本地 helper 的 checkpoint/hosting：第三参数仅是程序生成的非敏感 JSON 的 base64，hosting 只传返回的 project_id；不得传凭据。helper 原子写入并禁止替换已有项目。checkpoint 在变更之前写入，persistHosting 收到创建结果立即调用。状态显示 creating 而没有项目 ID 时，先核对原创建结果；不能再次 create。发布状态不明时先核对既有版本/部署，不能重复发布。
3. 新服务采用 owner-private，不改变访问受众。已有 ID 必须核对当前账号为 owner；私人受众不明时先核实，不能把 private 操作用作访问探测。首次初始化的授权覆盖此自有私人服务，不逐步骤重复问确认。不要请求 publish-on-push 实验窗口。
4. syncSource 使用 Sites 官方 source helper 的真实 TTY：短期凭据只从当前账号的原生返回保留在内存，经隐藏 stdin 传入，不写文件、命令参数或日志。检查并安装锁定依赖；当前 Windows npm 启动器有路径问题时，可使用已核对的 npm JavaScript 入口。运行源码验证及构建，推送确切源提交。能生成构建包时传 archive；本地 packager 缺 Bash 时用官方 prepare-site-build.cjs 和系统 tar 创建包含 hosting/migrations 的同一提交构建包，预先核实 staging 目录边界；不能打包才使用受支持的 remote-build fallback，不安装额外大框架。
5. waitForDeployment 在工具程序内等待已有部署的终态，空状态不逐轮请求模型，不自动创建第二份服务；失败或安全拒绝就返回明确错误。
6. 加载 host-runtime.js，调用 discoverAccount(tools, ALL_TOOLS, {projectId})，用原生 owner-private 记录及独立只读 MCP 探针核实账号、服务内身份、固定地址和实际工具前缀。保存其白名单返回值并用 prepare.mjs account-register 登记；account-bind 将该账号的实际 Chat 和授权目录保存在本 Codex 名下。账号配置共存，不覆盖全局旧映射；不存 auth_client_id、token 或短期源凭据，不放进通用分享包。缺少 channel 字段时，先将该用户自有服务更新到包内源码，不借用其他服务。
7. 核对实际工具可用。平台发布可能自动提供应用工具；get_site 的 plugin_id 本身不证明已经连接。需要安装时使用当前平台返回的精确 plugin_id 与受支持的插件安装入口。实际 publish_assignment/get_task_result 和 Chat submit_task_result 跑通后才写安装通过。
8. 以后启动时调用同一 ensureOwnResults，只查询已有 owner 项目并复用固定结果地址，不创建、安装依赖、推送或重新发布。任务正文仍走原生桌面消息。

## 手动协助

用户首选把 ZIP 附件或本机路径和安装目录交给 Codex，由 Codex 负责检查、解压和安装，再按本文初始化自己的私人结果通道；无需用户先解压或运行安装入口。手动解压保留为备用路径。Codex 处理这些步骤，登录或平台安全确认出现时只指出该页面上的必要动作。当前没有脱离 Codex 宿主的单命令账号发布器；缺少 Sites/插件连接能力时报告缺项，不要求用户猜测 clientId，也不能声称支持所有个人账户。
