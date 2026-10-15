# 宿主调用

多账号：首次用 host-runtime.js 的 discoverAccount(tools, ALL_TOOLS, {projectId})，通过原生 get_site 核实 owner-private 和所有者账号，并用只读 get_task_result 探针独立取得同一 MCP 地址的实际连接身份与工具前缀。账号 ID 与服务内 principalId 是不同的标识，不互相推导。只把返回的白名单连接对象保存为本机文件，再用 prepare.mjs account-register <文件> [显示名称] 登记；用户不填写这些字段。

账号登录变化或不确定时，先将 prepare.mjs accounts 返回的 accounts 交给 resolveCurrentAccount(tools, ALL_TOOLS, accounts)。程序只读核验已保存服务及对应 Chat，唯一匹配时返回当前账号与保存的绑定；Codex 用 account-switch 恢复该账号。needsConnectionUpdate=true 时先保存返回的白名单连接并 account-register 更新正式前缀。未匹配时引导本人登录/首次配置，不猜账号；多个匹配时核对目标。整个解析不发送消息、上传材料或改变平台设置。

用 account-bind <accountId> <Chat URL> <材料目录> 给本 Codex 保存该账号的绑定。以后 accounts 列出已保存账号及各自 Chat/目录；用户要求换账号时，先核实该账号当前服务和 Chat 可用，再用 account-switch <accountId> 恢复已有绑定。新账号未配置时走首次初始化，已有账号复用固定地址。切换本机配置不完成平台登录；登录或安全确认由本人完成。程序每次进入均检查实际当前身份，所有结果与附件响应也校验同一地址和 principalId。

旧 schema 1 自动迁移到 schema 2，但不猜账号归属，不改旧目标。核实原账号后用 account-register/account-bind 补上身份。新的 CLI prepare 必须已有账号连接；旧的已发送任务保留原包续等，不强行换账号。每个 Codex 在不同账号保存一份 Chat/目录，切换不覆盖原配置；任一待完成任务阻止切换或更改通道。结果包固定账号、服务和 Chat，旧账号的包不能在新账号下加载或取结果。unbind 只移除当前账号绑定，其他账号保留。

## 统一入口

由 Codex 生成请求文件，不让用户编辑 JSON。正文 wholeFile=true 时测量完整版本；片段提供整文件 sha256 与准确行范围。附件 path 是授权目录内的相对路径。只收生成文件设 receiveAttachments=true。用户选择生图时设 kind=design、imageGeneration=true，用 imagePrompt 提供单条画面要求，或 imagePrompts 提供 1–16 条；不同时使用两者，不设 receiveAttachments。只写画面要求，不加任务编号、MCP 或回传指令。需要的参考材料先另行提供，不混入此纯指令包。

一次 functions.exec 中加载并运行 scripts/job-entry.js，不把完整源码打印进模型上下文。普通任务自动 prepare/load、核对账号与目标、获取执行锁、传材料、发消息、等待、下载校验和清理。生图入口不加载附件 IO，不登记远程任务或查询正式结果；沿用当前账号绑定，通过平台所有者核验、原生 read_thread 和执行锁检查后发送。用户许可已经覆盖本次协作时，deliveryAuthorized=true；不会改变审批设置或读取登录凭据。

```javascript
// @exec: {"yield_time_ms": 60000, "max_output_tokens": 1500}
const scriptRoot = '已安装 skill 的 scripts 绝对路径';
const read = await tools.exec_command({cmd: 'Get-Content -LiteralPath '+"'"+(scriptRoot+'/job-entry.js').replaceAll("'","''")+"'"+' -Raw', max_output_tokens: 10000});
if (read.exit_code !== 0) throw new Error('ENTRY_NOT_AVAILABLE');
const entry = new Function('return (\n'+read.output+'\n)')();
const report = await entry.run(tools, ALL_TOOLS, {
  scriptRoot, requestPath: '请求文件绝对路径', outputRoot: '本任务独立下载目录',
  deliveryAuthorized: true,
  onProgress: event => notify(event)
});
store('codex-chat-last-outcome', report);
text({status:report.outcome.status, summary:report.outcome.result?.summary, sentCount:report.outcome.sentCount, instructionCount:report.outcome.instructionCount, chatUrl:report.outcome.chatUrl, downloads:report.outcome.downloads, cleanup:report.outcome.cleanup, metrics:report.metrics, recordPath:report.recordPath});
```

续等改传原 packetPath，不传 requestPath；从原状态恢复，不重发委托。sending/uncertain 保持不确定，不自动重试消息。只有正文、任务版本或必要材料变化才创建新 revision。旧自动取回图片包在统一入口返回 LEGACY_IMAGE_RETURN_DISABLED，保留原记录，不续发生图或导出。

单条生图指令原样发送，收到原生回执即返回 sent；最后一轮可能仍在生成，generationVerified=false，用户在返回的 chatUrl 查看和下载。多条指令按顺序排队：仅在上一条原文、发送时间窗口（允许 2 秒时钟误差）和轮次 ID 对应，且同轮 completed、对话 idle 时发送下一条。程序约每 30 秒核对，最后一条送达即结束。不追加导出、上传或结果催交，不调用 get_task_result；轮次结束仅用于队列调度，不证明出图成功或数量正确。目标正在运行或状态不明时不插入第一条；超时/取消报告 sentCount 和 instructionCount，原包保留未发送项。每条发送前保存 sending，回执不明后停止队列，不重发。

普通审核、规划、文字设计默认采用 result 策略：程序约每 30 秒查询 get_task_result，正式结果就绪立即收取；read_thread 仅用于启动时核对目标，以及每 5 分钟仍无结果时核对本次消息、发送时间窗口和对应轮次。确认该轮已完成但漏交时最多提醒提交一次，不重做任务；状态缺失、延迟或暂时报错不停止结果查询。旧版已发送包没有轮次锚点时只收取匹配结果，不猜轮次或重发。

普通结果等待和图片队列都在同一程序内完成，没有变化继续等；没有实现闲置 Codex 的事件唤醒。

程序默认等 10 分钟，每次最多 15 分钟，可按任务设置 timeoutMs；较短时限可能早于普通任务首次五分钟兜底。图片队列共用单次时限，不无限等待。实际间隔包含工具耗时，普通等待受输入附件原有到期时间限制；失败、取消或超时返回实际状态。空检查不返回模型。只用 functions.wait 续取同一 cell，不另开查询循环。上传、准备、下载与清理分别计入总耗时。

下载采用最多 3 个只读请求预取、顺序写盘，桥接代码保持在 64,000 字节审查上限内；逐块与整文件校验、禁止覆盖、账号/任务绑定、附件清理保持。程序不关闭认证或证书校验，不用其他通道绕过工具拒绝。

输出 outcome.json 包含状态及本次工具调用和耗时；图片队列记录逐条送达状态与轮次探针，普通任务记录消息、提交提醒、轮次探针、结果查询及五分钟兜底次数。程序等待不调用模型 API；宿主工具续取、状态反馈和最终展示可能仍使用 Codex 推理，用量按本会话真实日志统计，不把轮询数当模型请求数，也不把缓存输入当免费或未发生。

普通任务 completed 只覆盖实际范围；生图 sent 仅表示全部指令送达，不表示生成、下载或校验通过。cleanup.pending 或 executionCleanup.pending 如实报告、同包恢复；图片队列全部送达后释放本地占用，部分发送后超时则保留占用，另一个任务或换账号不能抢占。
