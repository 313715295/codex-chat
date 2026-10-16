# Codex 安装入口

使用用户指定的安装位置、材料范围和桌面 Chat 会话名；按原生列表核实目标，重名时核对项目。不把安装目录默认当作材料目录。用户说明见 README.txt 或 docs/getting-started.md。

1. ZIP 可由 Codex 核验并解压到新建可写目录，用户无需先解压。执行 source/collaboration/install-package.mjs --check，核对 Node 24.18 或以上的 24.x x64 与文件哈希，再执行同一安装入口。源码副本使用 source/collaboration/install.mjs。
2. 安装登记 %LOCALAPPDATA%/CodexChat/INSTALLATION.json 中的实际程序位置，不新增 skill，不启动服务或发送消息，不改权限。旧 skill 先保留，安装或绑定本身不产生协作许可。
3. 按 docs/codex/own-results-setup.md 配置或复用本账号私人服务。已有服务没有 get_collaboration_entry 时，先核实 owner-private 归属，再按 Sites 流程更新对应源码的 MCP 入口和 lib/collaboration-entry.ts；保留其 project_id、存储、数据、固定地址及受众。缺平台能力时说明缺项，不使用作者共享后台或让用户猜 clientId。
4. 独立核验连接身份，调用正式 get_collaboration_entry，运行它返回的 hostBootstrap，检查本机入口版本和 describe()。日常由该工具说明引导加载程序；参数见 docs/codex/requests.md，宿主示例见 docs/codex/host-entry.md。
5. 新链路可用后，由 Codex 执行 install-package.mjs --retire-legacy-skill（源码副本执行 install.mjs 同选项），自动迁移本工具管理的旧 skill。发现文件移入本机备份；旧运行脚本保留兼容既有调用。其他工具或无归属标记的 skill 不处理，不删除绑定、账号、材料或暂停任务。用户无需手动卸载或编辑配置。

本人只处理必要登录、平台连接或安全确认。首次配置后复用固定连接；现有待办不得抢占。不要将本机安装记录、账号映射、项目 ID、凭据、聊天或真实材料放进公开包。
