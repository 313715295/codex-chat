# Codex 宿主调用

私人 MCP 的 get_collaboration_entry 提供发现与调用说明，原生消息接口由 Codex 桌面提供；无需安装或读取 skill。完整编排仍在宿主内注入 tools / ALL_TOOLS，远程服务不会自行回调桌面。job-entry.js 的 describe() 提供共同规则和参数；缺桥接时在操作前返回 HOST_BRIDGE_REQUIRED。

## 账号与目标

首次连接见 [通道初始化](own-results-setup.md)。已配置账号用 prepare.mjs accounts 获取保存记录，交给 host-runtime.js 的 resolveCurrentAccount(tools, ALL_TOOLS, accounts) 独立核验当前 owner-private 服务、MCP 地址与实际连接身份。唯一匹配后 account-switch；needsConnectionUpdate 时保存返回的白名单连接再 account-register。不猜账号归属，登录或安全确认由本人完成。

按桌面会话名用原生列表/读取核实 Chat；重名时核对项目。用户不提供内部 ID。默认绑定用 account-bind / bind，新增并行目标用 prepare.mjs target-bind <精确 Chat URL> [材料目录] [显示名称]；省略目录沿用当前授权范围。targets 列出本 Codex 在当前账号的目标、默认目标和待办。每个目标单独保存材料目录，目录可以相同；target-remove 不能移除有待办或暂停任务的目标。

多目标请求在 request 中加入 targetThreadId，单目标省略则沿用原默认绑定。每项固定账号、Chat、授权目录、任务版本与回执。不同 Chat 可并行，同一 Chat 仍独占；另一个 Codex 不能复用这个 Chat。账号切换及默认绑定变更仍受待办保护。

## 同一程序执行

```javascript
// @exec: {"yield_time_ms": 60000, "max_output_tokens": 1500}
// 先使用 get_collaboration_entry 返回的 hostBootstrap，得到 bundle 与 entry。
const scriptRoot = bundle.info.scriptRoot;
const report = await entry.run(tools, ALL_TOOLS, {
  scriptRoot, requestPath: '请求文件绝对路径', outputRoot: '本任务独立输出目录',
  deliveryAuthorized: true, onProgress: event => notify(event)
});
store('codex-chat-last-outcome', report);
text({status:report.outcome.status, summary:report.outcome.result?.summary,
  downloads:report.outcome.downloads, cleanup:report.outcome.cleanup,
  metrics:report.metrics, recordPath:report.recordPath, packetPath:report.packetPath});
```

多 Chat 把 run 改为 runMany，公共 scriptRoot / deliveryAuthorized 保留，requestPath / outputRoot 改放 jobs 数组。每项提供 requestPath 或原 packetPath、独立且互不嵌套的 outputRoot，最多 8 项、必须是同一 Codex 和当前账号的已登记不同 Chat。程序先完成所有本地范围检查，串行提交桌面发送请求，再并行处理与等待；返回每项结果或错误及原包路径，一项失败不会丢弃其他项。使用 describe() 查看实际参数，不把整个实现读取到模型上下文。

本机安装记录为 %LOCALAPPDATA%/CodexChat/INSTALLATION.json，登记实际 packageRoot、scriptRoot 与 Node 路径。entry-info.mjs --host-bundle 只读返回本机入口；请求字段见 bundle.info.guides.requests。首次安装用包内 INSTALL_FOR_CODEX.md。

## 等待与恢复

普通任务约每 30 秒查正式 get_task_result，每五分钟仍无结果时核对对应轮次，确认有助手回复、已完成且漏交时最多提醒一次。普通任务不预发能力探针。生图只按上一轮结束后逐条发送，最后一条送达即返回，用户自行下载；另行要求收取已有文件时使用普通文件请求。轻量查探只在已有状态不能解释异常且一次调用能消除疑问时使用，不反复试探。

默认单次 10 分钟、最多 15 分钟，可设置 timeoutMs。所有空检查留在程序内，没有闲置事件唤醒；宿主续取仍可能触发模型响应。运行中的 cell 只用 functions.wait 续取。

超时用返回的原 packetPath 续等，不重发；sending/uncertain 保持不确定。确需补材料时沿用 taskId 并新建 revision。systemError 或工具缺失保留现场并报告阶段，不放宽认证、哈希、目录或回执检查。completed 只覆盖实际范围；生图 sent 仅为送达。

需要暂停后切换时，先结束 waiter，再 pause <原包>。resume <原包> 恢复原任务；多目标任务恢复自己的路由，不替换其他待办和默认 Chat。旧单目标包保留原语义，恢复会恢复原绑定。暂停继续保留账号、Chat、目录与通道，不代表成功、不撤回远端消息；新任务不能抢占暂停的 Chat。schema 1/2 首次正常写入迁移到 3，保留旧账号、绑定与暂停记录。
