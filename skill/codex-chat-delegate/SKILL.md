---
name: codex-chat-delegate
description: 用户指令或适用项目规则允许 Chat 协作或文件收发时使用，通过桌面消息和私人结果/附件通道传送材料，在工具程序内等待并取回结果。
---

# Codex ↔ Chat 协作

按用户指令或适用项目规则允许的范围使用 Chat，复用已确认的目标和材料目录。在许可范围内自动完成材料传送、补充、等待和结果取回；目标或材料范围无法确定时再询问。

## 材料

- 必要正文直接发送；片段注明整文件版本和准确行范围。
- 原文件按 [文件入口](references/attachments.md) 收发；只需接收生成文件时设 receiveAttachments=true；图片生成设 imageGeneration=true，并以 imagePrompt 提供具体画面要求；第一条只发该正文，结束后第二条单独导出。

Chat 返回 needs_materials 时，Codex 在授权目录内补充必要正文或附件，以同一 taskId 的新 revision 继续；重新提供后续仍需要的材料，旧版短期附件可能已清理。无法确定材料、超出范围或缺项重复且无新信息时报告原因。

只传必要材料，保留目录和敏感路径检查。文件名、sandbox 路径或哈希文字不算原文件传输。

## 执行

1. 用 prepare.mjs show 读取本 Codex 会话的账号、私人通道、Chat 和材料目录，原生 read_thread 核对目标。新账号按 [通道初始化](references/own-results-setup.md) 核实并保存；已配置账号用 account-switch 切换，保留各账号的绑定。每个 Codex 同时绑定一个 Chat，不同绑定可共用材料目录；待完成任务阻止切换。详见 [宿主入口](references/host-entry.md)。
2. 按宿主入口调用 job-entry.js，程序完成准备、执行锁、登记任务、发送与等待。图片任务先只发具体生成内容，核对该原消息与发送时间窗口及结束线索，再发最多一次原图导出指令；任务字段和上传/结果要求放在第二条。
3. 核对任务、版本和回执；回传文件下载后校验完整字节与哈希，清理短期附件，再继续当前任务。completed 只覆盖实际完成范围；cleanup.pending 或 executionCleanup.pending 如实报告。
4. 超时加载原包和状态续等；sending/uncertain 不盲目重发，待完成任务不插入新任务或盲目解除锁。

空查询、状态核对、图片导出续发和文件传输都在同一工具程序内处理，不逐轮请求模型；exec 返回运行中的 cell ID 时只用 wait 续取，不额外循环 read_thread 或读取空结果。工具宿主续取仍可能产生 Codex 用量，不能承诺整个会话零 token。程序不提供常驻后台或闲置会话唤醒。

## 连接与异常

缺少结果或附件工具时读取 [通道初始化](references/own-results-setup.md)，复用本账号私人服务。切换账号后核验当前私人服务所有者与实际工具连接身份；绑定账号不匹配时停止发送，协助本人登录或连接正确账号，不能仅改目标 Chat。

报告具体失败阶段与缺项；本人登录或安全确认按实际页面引导。保留认证和证书校验，遵守执行拒绝。
