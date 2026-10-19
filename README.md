# 视频 Skill 工作台

Windows 本机视频脚本与素材工作台：保存、预览和组合 Skill，根据商品图生成中文视频提示词，再导入 LibTV 画布，由使用者确认模型后手动生成。

当前公开版本：**0.1.16**。本次同步最新应用源码，并发布**仅含软件的 Windows 完整包**，不附带维护者当前的私人 Skill 库、商品图套、账号、API Key、数据库或生成记录。

## 下载与运行

- **[下载 Windows x64 软件包](https://github.com/kobong1965/video-skill-workbench/releases/download/v0.1.16/VideoSkillWorkbench-0.1.16-Windows-x64.zip)**
- [版本说明与校验文件](https://github.com/kobong1965/video-skill-workbench/releases/tag/v0.1.16)
- [SHA256SUMS.txt](https://github.com/kobong1965/video-skill-workbench/releases/download/v0.1.16/SHA256SUMS.txt)

ZIP 约 **189.5 MiB**（198,683,004 字节）。必须完整解压并保留全部子目录，不要只取 EXE。GitHub 自动生成的 Source code ZIP 是源码，不是可执行软件包。

要求：**Windows 10/11 x64、可用 E 盘、Microsoft WebView2 Runtime**。Node、.NET 及后台运行文件随软件提供。当前版本按 `E:\Codex工作盘` 的目录规则工作，并非任意盘符便携版。

1. 完整解压到 E 盘，例如 `E:\Codex工作盘\artifacts\latest`，打开 `VideoSkillWorkbench-0.1.16-Windows-x64\视频Skill工作台.exe`。
2. 新电脑首次使用：右上角“⋯ → 首次安装码”，自行创建管理员账号；已有账号无需重建。
3. 自行导入已获授权的 Skill，在“设置”配置自己的文字／视觉接口、模型及密钥，图片接口按需配置。
4. 上传商品或选择保存的款号图套 → 选择脚本 → 下一步 → 常规／高级设置 → 生成提示词。
5. 提示词完成后可导入 LibTV，只建工作流，不自动调用视频模型；确认模型、时长、比例与声音后手动生成。

**已有安装不要直接覆盖正在运行的程序。** 等待任务结束、备份数据后按维护者的原位更新流程处理，保留原快捷方式。不要删除或用他人数据替换 `E:\Codex工作盘\projects\video-skill-workbench-data`。

## 最新功能

- 圆角渐变界面、蜗牛 Logo、顶部草稿／下一步按钮、拖拽上传和大脚本预览。
- 款号图套保存复用；单任务最多 6 组／36 张唯一图片，支持换色、搭配、对比和排序。
- 任务栏与记录显示商品主图、所用脚本封面和中文生成状态，多脚本按顺序保留。
- **独立画布上传状态**：未上传、上传中、已上传、失败、待确认；依据当前提示词版本和真实导入记录，约每 3 秒刷新，旧版上传不冒充新版已上传。
- 多接口／多模型配置，按能力与容量自动分配并行任务；全局与单接口并发上限可调，满载后仍需等待空位。
- 全部提示词统一编辑、复制和保存版本；LibTV 按脚本分组布置，不自动生成。
- 单人模式不设置软件内账号额度或重试次数门槛；服务商余额、费用、限流和模型能力仍由服务商决定。
- 0.1.16 更新 Fastify、Sharp 及相关传递依赖，加入依赖版本回归检查；收紧任务卡行距，同时保留生成状态、画布状态、接口名称和详情按钮。

画布导入使用随包 LibTV CLI 与使用者自己的本机登录会话，不附带维护者的画布凭据。

## 源码与开发

`apps/` 为界面、API 和后台；`packages/` 为领域规则、提供商、画布及存储；`database/migrations/` 为数据库结构；`desktop/` 为 Windows 宿主和品牌资源。`scripts/`、`tests/` 保留通用构建及隔离测试，不含本机真实任务恢复、私人素材上传和一次性更新脚本。

Node 24.21.0、React 19.2.8、TypeScript 7.0.2、C# 14／.NET 10.0.12；依赖锁定在 `package-lock.json`。源码构建需预先准备对应 E 盘运行环境，包括 .NET SDK、内嵌 PostgreSQL、浏览器和 LibTV CLI，测试不会自动安装系统组件。普通用户使用 Windows 完整包即可。

在 E 盘源码目录显式指定依赖缓存和隔离输出，例如：

```powershell
npm ci --prefix "E:\Codex工作盘\projects\video-skill-workbench" --cache "E:\Codex工作盘\caches\video-skill-workbench\npm"
node scripts/run.mjs test --temp-root "E:\Codex工作盘\temp\video-skill-workbench\public-test" --artifacts-root "E:\Codex工作盘\artifacts\test-builds\video-skill-workbench\public-test" --output-root "E:\Codex工作盘\artifacts\test-builds\video-skill-workbench\public-test\web" --data-root "E:\Codex工作盘\temp\video-skill-workbench\public-test\unused-data"
```

公开测试使用合成账号、图片和标识，不依赖维护者私人 Skill；实际密钥只在软件本机配置中保存。

## 核验、隐私与许可

0.1.16 通过 348 项单元／集成测试、28 项相关浏览器回归、59 项原生窗口断言及独立完整包重启验收。公开副本另跑 348 项完整逻辑测试、类型检查与网页构建。视觉依据为浏览器回归，不声称完成原生截图验收。2026-10-19 使用官方 npm registry 审计全部依赖（含开发依赖），已知漏洞命中为 0；这不是对未来安全性或真实模型效果的保证。详见 [发布记录](docs/release-0.1.16.md)。

ZIP 内 4,712 个条目已逐项解压读取并核验 SHA-256。仅清除三份第三方依赖 Markdown 中覆盖率徽章 URL 的 token 参数，公开清单同步重算；应用及运行时字节不变，原安装不变。本次打包与发布不读取／导出生产数据库，也不调用真实 AI / LibTV 服务。

历史 `v0.1.6` 及仓库既有 `skills/`、`materials/`、`catalog.json` 保留为旧版已公开资料，**不表示本次附带或公开当前私人库**。软件未购买代码签名证书，Windows 可能提示，请核验 SHA-256，不要关闭系统防护。

本仓库没有新增统一开源许可。第三方许可和历史素材权利边界见 [NOTICE.md](NOTICE.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。软件不是离线 AI 模型，也不是远程多人托管服务；真实效果与费用取决于自行配置的服务商。
