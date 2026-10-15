# Codex 安装入口

执行前读取 skill/codex-chat-delegate/SKILL.md。使用用户已指定的安装位置、材料范围和桌面 Chat 会话名或链接；原生工具按名称定位，重名时核对项目或询问一次。不把安装目录默认当作材料目录。用户说明见使用包 README.txt 或仓库 docs/getting-started.md。

分享 ZIP 可由 Codex 核验并解压到新建的可写目录，无需用户事先解压。执行 source/collaboration/install-package.mjs --check，确认 Node 24.18 或以上的 24.x x64 与包内文件哈希，再执行同一安装入口。

源码开发副本使用 source/collaboration/install.mjs。安装不启动服务、不发送消息、不修改权限；安装与材料绑定本身不产生协作许可。

服务首次配置遵照 skill/codex-chat-delegate/references/own-results-setup.md。当前账号拥有独立私人服务，固定连接由平台实际返回；缺 Sites 或应用连接能力时说明缺项，不退回作者共享后台，不要求用户猜 clientId，不改变安全或审批设置。

先按通道初始化自动核验连接；实际需要本人登录、应用连接或平台确认时，再指出页面和具体动作。安装完成后按宿主支持方式刷新技能发现。

已有自有服务和账号绑定先核实再复用，待完成任务不得抢占。不要把本机绑定、hosting project_id、发布凭据、聊天记录或实际任务资料放进公开包。
