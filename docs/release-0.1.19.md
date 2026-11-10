# 视频 Skill 工作台 0.1.19

本版新增原生窗口菜单“检查版本更新”，并将后续软件发布与用户脚本资料分开。应用、后台与原生窗口使用同一个软件版本号。

- `VideoSkillWorkbench-0.1.19-Windows-x64.zip` 是 Windows 10/11 x64 程序完整包，要求可用 E 盘与 WebView2 Runtime。
- `SHA256SUMS.txt` 提供程序 ZIP 的 SHA-256；下载器按同一稳定版 Release 的校验文件验证 ZIP。手动下载也可使用 PowerShell `Get-FileHash -Algorithm SHA256` 比对。
- 新 Release 不再发布 Script-Skills ZIP。后续源码同步与程序包均排除用户 Skill 库、素材、商品目录、用户导出、数据库、账号、密钥和生成记录。

在原生窗口菜单选择“检查版本更新”可检查当前版本并下载 GitHub 上最新稳定版的程序 ZIP。检查、下载与校验不会同步用户资料，也不会自动替换运行中的程序。本版提供的是程序更新下载入口，安装仍需按以下步骤完成。

1. 等待当前任务全部完成，并备份原数据。
2. 将新版完整解压到 `E:\Codex工作盘\` 下另一个独立程序目录，保留软件包内所有子目录。
3. 关闭旧窗口并确认旧后台退出。若无法确认，可在任务完成后重启电脑，再启动新版；避免新旧后台同时运行。
4. 从新目录启动 `视频Skill工作台.exe`，确认可用后再调整快捷方式。

原固定数据目录 `E:\Codex工作盘\projects\video-skill-workbench-data` 保持不变。已有脚本、素材、账号与任务继续存放在本机原数据目录，不随程序下载重新导入；不要删除、移动或替换该目录。

软件打包继续采用程序白名单。发布路径检查拒绝用户库、`SKILL.md`、原视频、脚本 ZIP、旧安装 `ui-source/`、`ui-customizations/backend-import/`、秘密文件和用户数据库。包清单必须同时声明 `includesUserData: false` 与 `includesSkills: false`，并核对实际文件路径；依赖包中合法的 skill 名称、程序 `scripts/` 与合成测试 fixtures 不受“停止同步广告脚本”政策影响。

停止同步从本版起生效。本次保留既有 Git 历史和旧 Release，没有撤回 0.1.18 已发布的脚本合集或更早历史中的素材。需要清理已公开内容时，须另行明确历史范围；本版不作已清理历史的承诺。
