using System;
using System.Net;
using System.Net.Sockets;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
internal static class WindowsHostTests
{
    [STAThread] static int Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Program.ConfigureDisplay();
        if (Application.HighDpiMode != HighDpiMode.PerMonitorV2) throw new Exception("未启用 PerMonitorV2");
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        using (Program.ActivateEvent = new EventWaitHandle(false, EventResetMode.AutoReset)) {
            try { return Run(); }
            catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
        }
    }
    static int Run()
    {
        if (!WorkbenchWindow.Allowed("http://127.0.0.1:4178/")) throw new Exception("工作台导航被拒绝");
        if (!WorkbenchWindow.Allowed("http://127.0.0.1:4178/api/media/a")) throw new Exception("同源路径被拒绝");
        foreach (var url in new[] { "https://example.com", "file:///C:/secret.txt", "javascript:alert(1)", "http://127.0.0.1:4179/", "http://evil@127.0.0.1:4178/", "http://127.0.0.1.evil:4178/" })
            if (WorkbenchWindow.Allowed(url)) throw new Exception("允许了外部导航: " + url);
        var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        if (!WorkbenchWindow.PortIsListening(port)) throw new Exception("未发现本机监听端口");
        listener.Stop();
        if (WorkbenchWindow.PortIsListening(port)) throw new Exception("未启动服务被误判为已启动");
        using (var window = new WorkbenchWindow()) {
            if (window.AutoScaleMode != AutoScaleMode.Dpi) throw new Exception("原生窗口未启用逐显示器 DPI 布局缩放");
            if (window.MinimumSize.Width > FramelessWindow.AtDpi(800, window.DeviceDpi)) throw new Exception("最小窗口宽度阻止了 1080p/150% 下的重新排版");
            if (window.Controls.Find("window-titlebar", true)[0].Height < FramelessWindow.AtDpi(48, window.DeviceDpi)) throw new Exception("标题栏交互高度不足 48 逻辑像素");
            if (window.FormBorderStyle != FormBorderStyle.None) throw new Exception("窗口仍有系统边框");
            if (window.MainMenuStrip != null) throw new Exception("旧菜单栏仍占用一整行");
            var logos = window.Controls.Find("window-brand-icon", true);
            if (logos.Length != 1 || !(logos[0] is PictureBox) || ((PictureBox)logos[0]).Image == null) throw new Exception("窗口未显示品牌图标");
            foreach (var name in new[] { "window-minimize", "window-maximize", "window-close", "window-menu" })
                if (window.Controls.Find(name, true).Length != 1) throw new Exception("缺少自定义窗口操作: " + name);
            Control browser = null;
            foreach (Control child in window.Controls) {
                if (child is Microsoft.Web.WebView2.WinForms.WebView2) browser = child;
                if (child is Label) child.Visible = false;
            }
            browser.Visible = true; window.PerformLayout();
            if (browser.Top < window.Controls.Find("window-titlebar", true)[0].Bottom) throw new Exception("顶栏遮挡了页面内容");
        }
        var size = new Size(1440, 950);
        var points = new[] { new Point(1,1),new Point(1438,1),new Point(1,948),new Point(1438,948),new Point(1,400),new Point(1438,400),new Point(700,1),new Point(700,948),new Point(100,100) };
        var hits = new[] { 13,14,16,17,10,11,12,15,1 };
        for (int i = 0; i < hits.Length; i++) if (FramelessWindow.ResizeHit(points[i], size, false) != hits[i]) throw new Exception("窗口边缘缩放方向错误");
        if (FramelessWindow.ResizeHit(new Point(1,1), size, true) != 1) throw new Exception("最大化仍启用了边缘缩放");
        foreach (int dpi in new[] { 96, 120, 144, 192 }) {
            int grip = FramelessWindow.AtDpi(6, dpi);
            if (FramelessWindow.ResizeHit(new Point(grip-1, 100), size, false, dpi) != 10) throw new Exception("高 DPI 左侧命中区没有同步放大");
            if (FramelessWindow.ResizeHit(new Point(grip, 100), size, false, dpi) != 1) throw new Exception("高 DPI 命中区侵入内容");
            if (FramelessWindow.AtDpi(48, dpi) != dpi / 2) throw new Exception("标题栏缩放不是逻辑像素");
            foreach (var screen in new[] { new Rectangle(0, 0, 1920, 1040), new Rectangle(0, 0, 2560, 1400) })
                if (!screen.Contains(FramelessWindow.InitialBounds(screen, dpi))) throw new Exception("初始窗口超过屏幕可用区域");
        }
        if (FramelessWindow.RelativeWorkArea(new Rectangle(-1920,0,1920,1080), new Rectangle(-1920,40,1920,1040)) != new Rectangle(0,40,1920,1040)) throw new Exception("副屏最大化工作区错误");
        using (var window = new TestFrame()) {
            window.Show(); var bounds = window.Bounds;
            for (int i = 0; i < 3; i++) {
                window.ToggleMaximize(); window.ToggleMaximize();
                if (window.Bounds != bounds) throw new Exception("连续最大化还原改变了原窗口尺寸");
            }
            for (int i = 0; i < 3; i++) {
                ((Button)window.Controls.Find("window-minimize", true)[0]).PerformClick();
                window.WindowState = FormWindowState.Normal; Application.DoEvents();
                if (window.Bounds != bounds) throw new Exception("从最小化还原改变了原窗口尺寸");
            }
            window.Close();
        }
        Console.WriteLine("Windows 导航、冷启动、品牌图标、窗口操作、PerMonitorV2 及 100/125/150/200% DPI 尺寸计算：59 项通过"); return 0;
    }
    private sealed class TestFrame : FramelessWindow {
        internal TestFrame() { Width = 1440; Height = 950; ShowInTaskbar = false; Opacity = 0; InstallWindowChrome(new ContextMenuStrip()); }
    }
}
