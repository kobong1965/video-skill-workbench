# 视频 Skill 工作台

Windows 本机视频脚本与素材工作台：保存、预览和组合 Skill，根据商品图生成中文视频提示词，再导入 LibTV 画布，由使用者确认模型后手动生成。

当前软件版本为 **0.1.21**。从 0.1.19 开始，仓库同步与新 Release 仅发布程序源码、Windows 软件包和校验文件，不再同步脚本 Skill、素材库或其他用户资料。软件仍可使用和导入使用者自己的脚本。

## 下载与运行

- **[下载 Windows x64 软件包](https://github.com/kobong1965/video-skill-workbench/releases/download/v0.1.21/VideoSkillWorkbench-0.1.21-Windows-x64.zip)**
- [版本说明与校验文件](https://github.com/kobong1965/video-skill-workbench/releases/tag/v0.1.21)
- [SHA256SUMS.txt](https://github.com/kobong1965/video-skill-workbench/releases/download/v0.1.21/SHA256SUMS.txt)

请完整解压 Windows 软件包并保留全部子目录，再启动目录中的 EXE。下载后可用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 与该版本的 `SHA256SUMS.txt` 比对；软件内下载也会验证该校验文件。

要求：**Windows 10/11 x64、可用 E 盘、Microsoft WebView2 Runtime**。Node、.NET 及后台运行文件随软件提供。当前版本按 `E:\Codex工作盘` 的目录规则工作，并非任意盘符便携版。

1. 完整解压到 `E:\Codex工作盘\` 下的独立程序目录，例如 `E:\Codex工作盘\artifacts\latest\video-skill-workbench\windows-0.1.21`，打开其中的 `视频Skill工作台.exe`。
2. 新电脑首次使用：右上角“⋯ → 首次安装码”，自行创建管理员账号；已有账号无需重建。
3. 在工作台的“脚本”页导入自己的单个 Skill ZIP；已有安装沿用原数据目录内的脚本。在“设置”配置自己的文字／视觉接口、模型和密钥，图片接口按需配置。
4. 上传商品或选择保存的款号图套 → 选择脚本 → 下一步 → 常规／高级设置 → 生成提示词。
5. 提示词完成后可导入 LibTV，只建工作流，不自动调用视频模型；确认模型、时长、比例与声音后手动生成。

在 **设置 → 软件更新 → 检查更新** 打开版本更新窗口，或使用右上角“⋯”中的“检查版本更新”。设置页显示当前实际运行的桌面版本，更新窗口检查 GitHub 最新稳定版并下载程序 ZIP，使用同一 Release 的 `SHA256SUMS.txt` 验证完整性。检查与下载只处理程序，不同步脚本、素材、账号、密钥或数据库，也不自动覆盖正在运行的程序。旧桌面程序需先手动安装新版并将快捷方式指向新版，才能看到新入口。

升级时先等待当前任务完成并备份数据，将新版解压到 `E:\Codex工作盘\` 下另一个独立程序目录。关闭旧窗口并确认旧后台已退出后，再启动新版；不确定后台是否退出时，可在任务完成后重启电脑，再启动新版。确认新版可用后再调整快捷方式。原固定数据目录 `E:\Codex工作盘\projects\video-skill-workbench-data` 保持不变，不要删除、移动或用他人数据替换；不要同时运行新旧后台。

## 最新功能

- 设置页顶部新增“软件更新”板块和“检查更新”按钮，显示真实桌面版本。原生更新窗口检查稳定版、下载程序 ZIP 并验证 SHA-256；右上角菜单入口继续保留。更新采用独立程序目录，保留原本机数据。
- 软件发布与脚本资料分离：新版本不再同步或附带 Skill 合集、素材库、商品资料、数据库、导出记录和本机配置。
- 产品表支持按款号、品类、店铺及完整商品 ID 查找。选用商品后保存独立的选用资料，创作任务可以在 LibTV 画布中保留商品资料记录。产品表同步依赖本机目录中的产品表与媒体，手动款号和上传入口可直接使用。
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

`apps/` 为界面、API 和后台；`packages/` 为领域规则、提供商、画布及存储；`database/migrations/` 为数据库结构；`desktop/` 为 Windows 宿主和品牌资源。`scripts/` 是程序构建、运行与发布工具，继续随源码同步；`tests/` 保留隔离测试及合成 fixtures。“不再同步脚本”指使用者的广告脚本与 Skill 内容，不指程序源码中的 `scripts/` 目录。

`skills/`、`skill-library/`、`materials/`、`catalog.json`、用户导出、私人数据集、媒体及生产数据目录均排除在后续源码同步与软件包之外。旧安装的 `ui-source/`、`ui-customizations/backend-import/` 可能混有私人素材，也不能作为新版程序输入。Windows 打包沿用明确的程序白名单，并校验发行文件清单；`package-manifest.json` 必须明确声明 `includesUserData: false` 和 `includesSkills: false`，声明与文件路径不符时拒绝发行。

Node 24.21.0、React 19.2.8、TypeScript 7.0.2、C# 14／.NET 10.0.12；依赖锁定在 `package-lock.json`。源码构建需预先准备对应 E 盘运行环境，包括 .NET SDK、内嵌 PostgreSQL、浏览器和 LibTV CLI，测试不会自动安装系统组件。普通用户使用 Windows 完整包即可。

在 E 盘源码目录显式指定依赖缓存和隔离输出，例如：

```powershell
npm ci --prefix "E:\Codex工作盘\projects\video-skill-workbench" --cache "E:\Codex工作盘\caches\video-skill-workbench\npm"
node scripts/run.mjs test --temp-root "E:\Codex工作盘\temp\video-skill-workbench\public-test" --artifacts-root "E:\Codex工作盘\artifacts\test-builds\video-skill-workbench\public-test" --output-root "E:\Codex工作盘\artifacts\test-builds\video-skill-workbench\public-test\web" --data-root "E:\Codex工作盘\temp\video-skill-workbench\public-test\unused-data"
```

公开测试使用合成账号、图片和标识，不依赖维护者私人 Skill；实际密钥只在软件本机配置中保存。

## 核验、隐私与许可

软件发布的边界检查覆盖 Skill 库、`SKILL.md`、原视频、脚本压缩合集、用户数据目录、数据库和秘密文件；通用构建工具、数据库迁移及合法运行依赖继续保留。具体功能以 [0.1.21 版本说明](docs/release-0.1.21.md) 为准。

本次停止同步从 0.1.19 开始生效。既有 Git 历史以及旧版 `v0.1.18` Release 曾发布脚本 Skill，旧版更早的标签也可能包含素材；本次没有改写 Git 历史或删除旧 Release。停止后续同步不会撤回已公开内容，若需清理历史，应另行明确范围后处理。

当前 Windows 完整包未进行代码签名，可用 Release 的 SHA-256 文件核验下载。

本仓库没有新增统一开源许可。第三方许可和历史素材权利边界见 [NOTICE.md](NOTICE.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。软件不是离线 AI 模型，也不是远程多人托管服务；真实效果与费用取决于自行配置的服务商。
