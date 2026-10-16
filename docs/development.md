# 开发与构建

维护入口为 source/collaboration、skill/codex-chat-delegate 与 source/results-attachments-template。不要提交运行绑定、账号映射、临时平台凭据或真实任务资料。

用户操作只维护 docs/getting-started.md，打包时原样生成 README.txt；根 README.md 仅作为项目与下载入口。不要另建重复的首次使用说明。

## 环境

协作入口使用 Node 24.18 或以上的 24.x x64，无第三方本地运行依赖。后端沿用 Sites 的锁定模板依赖及平台构建约定，package-lock.json 必须一起维护。

## 测试

首次先在后端目录安装锁定依赖（MCP smoke 测试需要 zod 等库），再从仓库根目录运行测试：

```powershell
cd source/results-attachments-template
npm run install:ci
cd ../..
node scripts/test.mjs
```

运行本地协作测试、附件核心测试及内存数据库的 MCP smoke 测试，不连接真实账号、不发消息、不创建或发布服务。真实 Chat 和新用户验收必须单独报告，不能由单元测试代替。

## 后端构建

```powershell
cd source/results-attachments-template
npm run install:ci
npm run build
```

首次发布由当前账号的 Sites 宿主及其 skill 处理；不把一个用户的 .openai/hosting.json 或源仓库凭据复制给其他用户。模板的详细构建说明见其 README.md。

## Windows 使用包

```powershell
node scripts/release.mjs
```

构建器先生成干净目录并检查个人配置，创建 SHA-256 文件清单，再生成 downloads 下的 ZIP 和外部校验值。ZIP 包含协作入口、skill、干净后台模板、许可证和首次使用说明，不包含 node_modules、历史 reader、个人状态或开发测试输出。

打包使用 Windows PowerShell 和系统 .NET ZIP 支持，不需要额外 ZIP 程序。发布版本为 0.3.8；修改版本时同步安装/打包/插件清单与测试期望。推送对应 v 标签后，仓库 CI 先检查源码和后端构建，再核验已提交的 ZIP 与哈希，最后通过 GitHub Actions 临时令牌发布相同使用包；不在本机导出发布凭据。

源码 Install.cmd 仅更新已管理的本机 skill；使用包 Install.cmd 先验证 PACKAGE-MANIFEST.json。不可覆盖非本工具管理的已存在 skill。

## 开源检查

```powershell
node scripts/check-public.mjs
```

公开源码与使用包分别检查凭据模式、账号映射、私人服务/本机路径、生成物和模板 hosting 配置。扫描不是完整安全审计；新增文件要审查来源与第三方许可证。
