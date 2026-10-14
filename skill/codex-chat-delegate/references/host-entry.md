# 宿主调用

多账号：首次用 host-runtime.js 的 discoverAccount(tools, ALL_TOOLS, {projectId})，通过原生 get_site 核实 owner-private 和所有者账号，并用只读 get_task_result 探针独立取得同一 MCP 地址的实际连接身份与工具前缀。账号 ID 与服务内 principalId 是不同的标识，不互相推导。只把返回的白名单连接对象保存为本机文件，再用 prepare.mjs account-register <文件> [显示名称] 登记；用户不填写这些字段。

账号登录变化或不确定时，先将 prepare.mjs accounts 返回的 accounts 交给 resolveCurrentAccount(tools, ALL_TOOLS, accounts)。程序只读核验已保存服务及对应 Chat，唯一匹配时返回当前账号与保存的绑定；Codex 用 account-switch 恢复该账号。needsConnectionUpdate=true 时先保存返回的白名单连接并 account-register 更新正式前缀。未匹配时引导本人登录/首次配置，不猜账号；多个匹配时核对目标。整个解析不发送消息、上传材料或改变平台设置。

用 account-bind <accountId> <Chat URL> <材料目录> 给本 Codex 保存该账号的绑定。以后 accounts 列出已保存账号及各自 Chat/目录；用户要求换账号时，先核实该账号当前服务和 Chat 可用，再用 account-switch <accountId> 恢复已有绑定。新账号未配置时走首次初始化，已有账号复用固定地址。切换本机配置不完成平台登录；登录或安全确认由本人完成。程序每次进入均检查实际当前身份，所有结果与附件响应也校验同一地址和 principalId。

旧 schema 1 自动迁移到 schema 2，但不猜账号归属，不改旧目标。核实原账号后用 account-register/account-bind 补上身份。新的 CLI prepare 必须已有账号连接；旧的已发送任务保留原包续等，不强行换账号。每个 Codex 在不同账号保存一份 Chat/目录，切换不覆盖原配置；任一待完成任务阻止切换或更改通道。结果包固定账号、服务和 Chat，旧账号的包不能在新账号下加载或取结果。unbind 只移除当前账号绑定，其他账号保留。

## 统一入口

由 Codex 生成请求文件，不让用户编辑 JSON。正文 wholeFile=true 时测量完整版本；片段提供整文件 sha256 与准确行范围。附件 path 是授权目录内的相对路径。只收生成文件设 receiveAttachments=true；图片生成设 kind=design、imageGeneration=true、imagePrompt。imagePrompt 只写画面内容、风格、构图、质量和必要创作约束，不加任务编号、MCP、回传、计量或验收要求。请求字段由 Codex 生成；需要的参考材料先另行提供，不混入此纯生成包。

一次 functions.exec 中加载并运行 scripts/job-entry.js，不把完整源码打印进模型上下文。它自动 prepare/load、核对账号与目标、获取执行锁、传材料、发消息、等待、下载校验和清理。用户许可已经覆盖本次协作时，deliveryAuthorized=true；不会改变审批设置或读取登录凭据。

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
text({status:report.outcome.status, summary:report.outcome.result?.summary, downloads:report.outcome.downloads, cleanup:report.outcome.cleanup, metrics:report.metrics, recordPath:report.recordPath});
```

续等改传原 packetPath，不传 requestPath；从原状态恢复，不重发委托。sending/uncertain 保持不确定，不自动重试消息。图片第二条导出本身也先保存 sending，最多一次；下一次进程不重复续发。只有正文、任务版本或必要材料变化才创建新 revision。

图片采用两条消息：第一条原样发送 imagePrompt，内部任务登记与回执仍由程序保留；第二条仅导出上一轮原图，明确点名已核实私人服务的应用名称，包含 taskId/revision/receipt 和上传、提交结果的必要要求。发第二条的条件：尚无结果；原生摘要的最新用户消息精确匹配 imagePrompt，其开始时间在原发送请求与回执窗口内（允许 2 秒时钟误差）；同轮显示 idle/completed，活动时间比用户消息更新。旧版已发送包仍用原 taskId/revision/receipt 匹配，不改包、不重发生成。图片可能不出现在原生文字摘要中，因此这些只是结束线索，不能当作原图已回传的证据。仅 elapsed 或 idle 不触发；正在上传的附件不触发；发前再次查结果。续发只导出已有原图，不重新生成，已上传 ready 结果优先复用。无法取得结束线索就返回实际超时，不猜状态或无限续发。

程序默认文字任务等 3 分钟、附件任务等 10 分钟，每次最多 15 分钟；结果查询约每 10 秒，图片原生状态探针约每 30 秒、发送后至少 60 秒才考虑续发。实际间隔包含工具耗时；等待受输入附件原有到期时间限制。空查询不返回模型。只用 functions.wait 续取同一 cell，不再为每轮查询创建 exec 或发消息。上传、准备、下载与清理分别计入总耗时。

下载采用最多 3 个只读请求预取、顺序写盘，桥接代码保持在 64,000 字节审查上限内；逐块与整文件校验、禁止覆盖、账号/任务绑定、附件清理保持。程序不关闭认证或证书校验，不用其他通道绕过工具拒绝。

输出 outcome.json 包含终态及本次工具调用和耗时，state.metrics 保留累计消息/自动导出/探针/结果查询次数，约每分钟保存。程序等待不调用模型 API；宿主工具续取、状态反馈和最终展示可能仍使用 Codex 推理，用量按本会话真实日志统计，不把轮询数当模型请求数，也不把缓存输入当免费或未发生。

completed 只覆盖实际范围；图片 completed 必须有真实图片附件并完成完整下载。cleanup.pending 或 executionCleanup.pending 如实报告、同包恢复；超时保留任务占用，另一个任务或换账号不能抢占。
