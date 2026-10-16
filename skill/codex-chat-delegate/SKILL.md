---
name: codex-chat-delegate
description: 在用户指令或项目规则允许的范围内，通过桌面消息和私人通道向指定 Chat 发送请求、材料并取回结果与文件；也支持仅发送生图指令。
---

# Codex ↔ Chat 宿主入口

连接 Codex 桌面消息与已有私人 MCP 工具。业务内容由使用者决定；安装和保存绑定本身不代表安排协作。

按 [宿主调用](references/host-entry.md) 在同一工具程序中加载 scripts/job-entry.js；调用 describe() 获取参数与共同规则，单目标用 run()，多个 Chat 用 runMany()。请求写法按需看 [字段说明](references/requests.md)，首次配置或账号变化看 [通道初始化](references/own-results-setup.md)。使用已确认的目标和材料授权；用户只提供会话名，无需编辑配置或逐次选择 skill。

空查询、分块、校验、等待与恢复交给程序。exec 返回 cell ID 后只续取该 cell，不另开轮询。按实际结果报告；宿主续取仍可能消耗模型用量。
