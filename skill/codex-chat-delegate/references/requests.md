# 写给执行 Codex 的请求说明

先决定本次要发送什么、是否等待文字结果、是否接收原文件。任务的专业方法和输出格式按使用者要求，不由传输工具规定。

正文只保留目标、必要背景、交付要求和附件引用。长方案、代码、日志等用 attachments 传送，directMaterials 只放必要短片段。由执行 Codex 选择和准备材料，用户无需手工拆分；工具保留现有校验，不自动删改或拆分请求。

## 请求字段

由 Codex 写请求文件，用户只说明意图。常用字段：

| 字段 | 用途 |
| --- | --- |
| goal | 一段明确的目标和交付要求，必填 |
| targetThreadId | 可选，当前账号下已登记的目标 Chat；Codex 按会话名解析后填写。省略沿用默认绑定 |
| context / criteria | 必要背景和验收条件，按需填写 |
| directMaterials | 必要短片段：path、text、准确 startLine/endLine；短小整文件可设 wholeFile=true |
| files | 片段对应的整文件元数据：path、sha256，可含 sizeBytes/totalLines；不放正文。wholeFile=true 时程序自动测量，无需重复提供 |
| attachments | 选定原文件：授权根内相对 path 与 mimeType；程序测量大小和哈希 |
| receiveAttachments | 需要收取输出原文件时设 true；无需输入附件也可使用 |
| kind | 兼容协议的分类 review/design/planning，不限制业务用途；默认 review |
| imageGeneration / imagePrompt(s) | 仅发送模式：设 kind=design、imageGeneration=true，提供一条 imagePrompt 或 1–16 条 imagePrompts；不混入材料或 receiveAttachments |

程序生成 taskId、版本、回执、通道说明和提交要求。用户无需了解这些字段。只在恢复或补材料时沿用原 taskId、采用原包或新 revision，避免重复发送。

多个 Chat 各写独立请求并使用 job-entry.runMany(tools, ALL_TOOLS, {scriptRoot, deliveryAuthorized:true, jobs:[...]})，参数形式见宿主入口。不同目标的同名 taskId 由程序隔离；每项拥有独立结果、输出目录与恢复状态。同一 Chat 不并发插入。

## 指令示例

普通任务：

> 审核所附重命名方案，指出会导致文件丢失或引用失效的问题，返回修改建议。

接收已有文件：

> 将刚才生成的五张原图传回，保持原文件，不重新生成；缺少的逐项说明。

配 receiveAttachments=true，无输入文件时不制造占位材料。输出名称与附件的对应关系写在 summary 或 findings.message。materialsRead=[]；finding 不填输入 path，attachmentIds 填已就绪的真实结果 ID。

仅发送生图：

> 雨后山巅，两位剑客交锋，横版电影构图，无文字。

直接作为 imagePrompt，不追加协议、校验或回传步骤。已有参考图必须明确来源；Chat 实际未能看到的图不能写成“已确认参考图”。

## 控制协调成本

- 只传当前任务必要材料，不传整个项目，也不要求 Chat 搜索本地目录。
- 明确“处理任务”或“只取已有结果”，避免导出时重复审核或生成。
- 程序按本轮输入自动附上需要的工具说明；Codex 不再重复堆叠工具清单、JSON 模板和哈希步骤。
- 正常任务不先发测试消息。状态、分块和空查询在工具内处理；只报告有用进度、完成、失败或需要用户操作的情况。

结果协议仍校验身份、任务、版本和回执。materialsRead 是输入证据；输出文件使用 attachmentIds。服务模板的工具描述与程序提示均区分两者，不通过放宽校验接收错误结果。
