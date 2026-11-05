# 视频 Skill 工作台 0.1.18

本版包含应用源码、Windows x64 完整包与脚本 Skill 合集。工作台新增产品表选款、品类和店铺筛选，任务可保留选款时的商品资料。导入 LibTV 时，商品资料可留存在独立记录节点。

- `VideoSkillWorkbench-0.1.18-Windows-x64.zip` 是 Windows 10/11 x64 完整包，适用于有 E 盘和 WebView2 Runtime 的环境。完整解压后运行 `视频Skill工作台.exe`。
- `VideoSkillWorkbench-0.1.18-Script-Skills.zip` 包含 30 个 Skill 的当前版本和 1 个历史版本。解压合集后，在软件中打开“脚本 → 导入”，逐个选择 `import-packages/current/` 下的 ZIP。参考视频和封面需要在本机补充。强制依赖完整原对标的脚本在包内写明了需要补齐的文件。
- `SHA256SUMS.txt` 记录两个 ZIP 的 SHA-256。软件包和脚本合集的内容边界见仓库 README。

公开源码通过 390 项单元和集成测试、TypeScript 检查及生产网页构建。Windows 压缩包的 4,730 个条目均已解压核验，包内服务通过隔离启动、首次开通、Skill 导入和重启读取。31 个脚本 ZIP 均通过工作台导入解析。

应用和后台发行版本为 0.1.18。沿用的原生窗口 EXE 文件属性及帮助弹窗仍显示 0.1.16，本次独立包验收覆盖包内服务与网页入口。
