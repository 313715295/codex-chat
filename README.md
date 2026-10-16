# Codex ↔ Chat

供 Codex 使用的消息与文件传输工具：向指定的桌面端 ChatGPT 会话发送请求和必要材料，再取回文字结果或原文件。做什么、怎样处理、是否取回，由使用者决定；审核、规划、设计和生图都是用法示例。

**[下载 Windows x64 使用包 v0.3.10](https://github.com/313715295/codex-chat/releases/download/v0.3.10/codex-chat-windows-x64-v0.3.10.zip)** · [版本与校验值](https://github.com/313715295/codex-chat/releases/tag/v0.3.10)

把 ZIP 交给 Codex，说明安装位置、允许发送的材料目录和目标 Chat 会话名。Codex 按 [使用指南](docs/getting-started.md) 安装并配置你的私人通道；需要本人登录或平台授权时会明确引导。ZIP 内 README 与该指南相同。

程序负责协议字段、分块、哈希、等待与清理；skill 指导执行 Codex 写简短准确的请求，不让使用者手改 JSON。业务指令与传输步骤分开，普通任务不额外发送前置探针；空查询留在程序内，宿主续取仍可能消耗 Codex 用量。

需要 Windows x64、Node 24.18 或以上的 24.x x64，以及 Codex 桌面原生消息、当前账号的 Sites 发布和私人 MCP 连接能力。每人使用自己的固定地址服务，选定附件短期远程保存；无需本地 reader 或临时隧道。

默认生图只逐条发送指令，用户在 Chat 下载；另行要求取回已有文件时可走文件通道。文件传输成功不保证 Chat 获得可感知的图像或声音。首次使用、多账号和平台兼容性的实际边界见 [验证记录](docs/validation.md)。

- [请求写法](skill/codex-chat-delegate/references/requests.md)：供执行 Codex 阅读。
- [实现与边界](docs/architecture.md) · [开发与构建](docs/development.md) · [安装入口](INSTALL_FOR_CODEX.md)

MIT 许可证；[第三方说明](THIRD_PARTY_NOTICES.md)。
