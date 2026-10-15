# Codex ↔ Chat

支持 Codex 与指定 ChatGPT 对话协作：发送任务和必要材料，自动等待并取回文字结果或原文件。适用于审核、规划、设计和文件处理；按用户指令或项目规则允许的范围使用。图片生成可选仅发送指令，由用户在 Chat 查看和下载。

## 下载与使用

**[下载 Windows x64 使用包 v0.3.7](https://github.com/313715295/codex-chat/releases/download/v0.3.7/codex-chat-windows-x64-v0.3.7.zip)** · [版本与校验值](https://github.com/313715295/codex-chat/releases/tag/v0.3.7)

把 ZIP 交给 Codex，告诉它安装位置、材料目录和目标 Chat 对话即可。安装步骤和日常用法见 **[使用指南](docs/getting-started.md)**；ZIP 内的 README 与该指南内容相同。

需要 Windows x64、Node 24.18 或以上的 24.x x64，以及 Codex 桌面的原生消息工具、当前账号可用的 Sites 发布和私人 MCP 连接能力。首次登录与平台授权由本人完成。

每位用户使用自己的固定地址私人服务，首次连接后复用。选定文件会短期存放在远程服务中；不上传整个项目，不使用本地 reader 或临时隧道。

图片指令逐条发送：上一轮结束后再发下一张，最后一条送达即结束，用户在 Chat 自行下载。既有账号文字、文件往返及三条生图指令队列已验证；新账号私人服务和自动连接已核验，真实任务因 Chat 系统错误暂停，完整首次使用及多账号切换仍待验收。详见 [验证记录](docs/validation.md)。

## 开发

- [实现与边界](docs/architecture.md)：消息、附件、等待和账号绑定。
- [开发与构建](docs/development.md)：源码目录、测试及打包。
- [Codex 安装入口](INSTALL_FOR_CODEX.md)：供安装时执行。

MIT 许可证；第三方素材与依赖见 [第三方说明](THIRD_PARTY_NOTICES.md)。
