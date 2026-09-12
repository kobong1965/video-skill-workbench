# 蜗牛品牌资产

- `logo-source.png`：用户指定原图的逐字节副本，1024×1024，保留透明度。
- `workbench.ico`：从原图等比例缩放生成，包含 16、24、32、48、64、128、256 像素 PNG 帧，32 位色。
- `../../apps/web/src/assets/brand-logo.png`：原图缩放到 256×256 的 PNG，使用现有 Sharp，压缩级别 9，不进行有损量化。

更换品牌时同步生成上述派生文件，并运行 `tests/unit/branding.test.ts`、Windows 原生检查与网页构建。
网页图标经 Vite 静态导入进入带摘要的 assets 目录；打包脚本使用 `/win32icon` 嵌入 EXE，并将同一个 ICO 放到安装根目录供桌面快捷方式引用。
原生窗口从自身 EXE 提取图标，避免从桌面原始素材路径加载，确保原图移动后软件仍可运行。
