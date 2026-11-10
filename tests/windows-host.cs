using System;
using System.Net;
using System.Net.Sockets;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
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
        TestSoftwareUpdates();
        TestSettingsUpdateBridge();
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
        Console.WriteLine("Windows 导航、冷启动、品牌图标、窗口操作、PerMonitorV2 及 100/125/150/200% DPI 尺寸计算：59 项通过；版本更新校验及离线下载测试通过"); return 0;
    }
    static void TestSettingsUpdateBridge()
    {
        string action, id;
        foreach (string command in new[] { "info", "open" }) {
            string message = JsonSerializer.Serialize(new { type = "vsw-software-update", action = command, requestId = "test-request_1" });
            if (!WorkbenchWindow.TryUpdateMessage("http://127.0.0.1:4178/", message, out action, out id) || action != command || id != "test-request_1") throw new Exception("设置页更新按钮命令被拒绝");
            foreach (string source in new[] { "https://example.com", "http://127.0.0.1:4179/", "http://localhost:4178/", "http://evil@127.0.0.1:4178/", "file:///secret", null })
                if (WorkbenchWindow.TryUpdateMessage(source, message, out action, out id)) throw new Exception("外部页面取得了更新桥接能力");
        }
        foreach (string message in new[] { "{}", "[]", "null", "not JSON", "{\"type\":\"vsw-software-update\",\"action\":\"download\",\"requestId\":\"1\"}", "{\"type\":\"vsw-software-update\",\"action\":\"open\",\"requestId\":\"1\",\"url\":\"https://evil.example\"}", "{\"type\":\"vsw-software-update\",\"action\":\"open\",\"requestId\":\"../path\"}", "{\"type\":\"vsw-software-update\",\"action\":\"open\",\"requestId\":1}", new string('x', 1025) })
            if (WorkbenchWindow.TryUpdateMessage("http://127.0.0.1:4178/", message, out action, out id)) throw new Exception("更新桥接接受了不受支持的命令或路径");
    }
    static void TestSoftwareUpdates()
    {
        Version version;
        foreach (string invalid in new[] { "", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03", "1.2.-1", "1.2.3-beta", "1.2.3+build", "v1.2.3", " 1.2.3", "1.2.3\n", "2147483648.0.0" })
            if (SoftwareUpdates.TryVersion(invalid, out version)) throw new Exception("接受了无效数字版本号：" + invalid);
        if (!SoftwareUpdates.TryVersion("0.1.19", out version) || version != new Version(0, 1, 19)) throw new Exception("未识别三段版本号");
        if (!SoftwareUpdates.IsNewer(new Version(0, 1, 9), new Version(0, 1, 19)) || SoftwareUpdates.IsNewer(version, new Version(0, 1, 18)) || SoftwareUpdates.IsNewer(version, version)) throw new Exception("版本比较没有阻止降级或重复下载");
        if (SoftwareUpdates.IsNewer(null, version)) throw new Exception("未知本机版本仍可下载");
        if (SoftwareUpdates.ParseLocalVersion("{\"id\":\"test\",\"version\":\"1.22.333\"}") != new Version(1, 22, 333)) throw new Exception("当前版本未从 release.json 读取");
        ExpectUpdateFailure(() => SoftwareUpdates.ParseLocalVersion("{\"version\":\"0.1.19-beta\"}"));

        byte[] package = Encoding.UTF8.GetBytes("offline test package");
        string name = SoftwareUpdates.PackageName(version);
        string hash = Convert.ToHexStringLower(SHA256.HashData(package));
        byte[] sums = Encoding.UTF8.GetBytes(hash + "  " + name + "\n");
        string json = ReleaseJson(package.Length, sums.Length);
        var release = SoftwareUpdates.ParseRelease(json);
        if (release.Package.Name != name || release.Version != version || release.Notes != "离线测试说明") throw new Exception("正式发布解析错误");
        foreach (string tag in new[] { "0.1.19", "v0.1.19-beta", "v00.1.19", "v0.1.19.0" }) ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, tag: tag)));
        ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, draft: true)));
        ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, prerelease: true)));
        ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, assetName: "VideoSkillWorkbench-0.1.19-Script-Skills.zip")));
        ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, includeChecksum: false)));
        ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(SoftwareUpdates.MaximumPackageBytes + 1, sums.Length)));
        ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, state: "new")));

        string expectedUrl = "https://github.com/kobong1965/video-skill-workbench/releases/download/v0.1.19/" + name;
        foreach (string invalid in new[] { expectedUrl.Replace("https:", "http:"), expectedUrl.Replace("github.com/", "github.com.evil/"), expectedUrl.Replace("github.com/", "user@github.com/"), expectedUrl.Replace("kobong1965", "other"), expectedUrl.Replace("v0.1.19/", "v0.1.18/"), expectedUrl + "?token=x", expectedUrl + "#fragment", expectedUrl.Replace(name, "SHA256SUMS.txt/../" + name) }) {
            if (SoftwareUpdates.AllowedAssetUrl(invalid, version, name)) throw new Exception("接受了外部或错误版本下载地址：" + invalid);
            ExpectUpdateFailure(() => SoftwareUpdates.ParseRelease(ReleaseJson(package.Length, sums.Length, url: invalid)));
        }
        if (!SoftwareUpdates.AllowedRedirect(new Uri("https://release-assets.githubusercontent.com/path?signature=sample"), release.Package)) throw new Exception("合法 GitHub 资源重定向被拒绝");
        foreach (string invalid in new[] { "https://evil.example/file", "https://release-assets.githubusercontent.com.evil/file", "http://release-assets.githubusercontent.com/file", "https://user@release-assets.githubusercontent.com/file", "https://github.com/other/repo/file", "https://release-assets.githubusercontent.com:444/file" })
            if (SoftwareUpdates.AllowedRedirect(new Uri(invalid), release.Package)) throw new Exception("接受了非法资源重定向：" + invalid);
        if (SoftwareUpdates.FindChecksum(Encoding.UTF8.GetString(sums), name) != hash || SoftwareUpdates.FindChecksum("\uFEFF" + hash.ToUpperInvariant() + " *" + name + "\r\n", name) != hash) throw new Exception("标准 SHA-256 清单解析错误");
        foreach (string invalid in new[] { hash + "  " + name + ".bak", hash + "  ./" + name, hash + "  other/" + name, hash + "  " + name.ToLowerInvariant(), new string('g', 64) + "  " + name, hash + " " + name, hash + "  " + name + "\n" + hash + "  " + name })
            ExpectUpdateFailure(() => SoftwareUpdates.FindChecksum(invalid, name));

        string root = Path.Combine(Path.GetTempPath(), "workbench-updates-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        string previous = Path.Combine(root, "previous.zip"); File.WriteAllText(previous, "keep previous download");
        try {
            using (var http = new HttpClient(new ReleaseHandler(package, sums))) {
                string downloaded = SoftwareUpdates.DownloadAsync(http, release, new Version(0, 1, 18), root, null, CancellationToken.None).GetAwaiter().GetResult();
                if (Path.GetFileName(downloaded) != name || !File.ReadAllBytes(downloaded).SequenceEqual(package)) throw new Exception("校验后的完整包未正确保存");
                ExpectUpdateFailure(() => SoftwareUpdates.DownloadAsync(http, release, version, root, null, CancellationToken.None).GetAwaiter().GetResult());
            }
            string[] completeBefore = Directory.GetFiles(root, "*.zip", SearchOption.AllDirectories);
            using (var http = new HttpClient(new ReleaseHandler(Encoding.UTF8.GetBytes("wrong data"), sums, package.Length)))
                ExpectUpdateFailure(() => SoftwareUpdates.DownloadAsync(http, release, new Version(0, 1, 18), root, null, CancellationToken.None).GetAwaiter().GetResult());
            byte[] badSums = Encoding.UTF8.GetBytes(new string('0', 64) + "  " + name + "\n");
            using (var http = new HttpClient(new ReleaseHandler(package, badSums)))
                ExpectUpdateFailure(() => SoftwareUpdates.DownloadAsync(http, release, new Version(0, 1, 18), root, null, CancellationToken.None).GetAwaiter().GetResult());
            using (var cancelled = new CancellationTokenSource())
            using (var http = new HttpClient(new ReleaseHandler(package, sums))) {
                cancelled.Cancel();
                try { SoftwareUpdates.DownloadAsync(http, release, new Version(0, 1, 18), root, null, cancelled.Token).GetAwaiter().GetResult(); throw new Exception("取消后仍下载成功"); }
                catch (OperationCanceledException) { }
            }
            byte[] chunkedPackage = new byte[200000];
            byte[] chunkedSums = Encoding.UTF8.GetBytes(Convert.ToHexStringLower(SHA256.HashData(chunkedPackage)) + "  " + name + "\n");
            var chunkedRelease = SoftwareUpdates.ParseRelease(ReleaseJson(chunkedPackage.Length, chunkedSums.Length));
            bool cancelledAfterWrite = false;
            using (var cancelled = new CancellationTokenSource())
            using (var http = new HttpClient(new ReleaseHandler(chunkedPackage, chunkedSums, packageStream: () => new CancelAfterChunkStream(chunkedPackage, () => {
                var partials = Directory.GetFiles(root, "*.partial", SearchOption.AllDirectories);
                if (partials.Length != 1 || new FileInfo(partials[0]).Length < 81920) throw new Exception("测试未在首个数据块实际写入后触发取消");
                cancelledAfterWrite = true; cancelled.Cancel();
            })))) {
                try { SoftwareUpdates.DownloadAsync(http, chunkedRelease, new Version(0, 1, 18), root, null, cancelled.Token).GetAwaiter().GetResult(); throw new Exception("下载中途取消后仍报告成功"); }
                catch (OperationCanceledException) { }
            }
            if (!cancelledAfterWrite) throw new Exception("未执行实际写入后的取消测试");
            if (!Directory.GetFiles(root, "*.zip", SearchOption.AllDirectories).OrderBy(path => path).SequenceEqual(completeBefore.OrderBy(path => path)) || Directory.GetFiles(root, "*.partial", SearchOption.AllDirectories).Length != 0 || File.ReadAllText(previous) != "keep previous download") throw new Exception("失败或取消覆盖了旧下载或留下完整包");
        } finally { Directory.Delete(root, true); }
    }
    static void ExpectUpdateFailure(Action action)
    {
        try { action(); } catch (InvalidDataException) { return; }
        throw new Exception("更新安全校验应拒绝该输入");
    }
    static string ReleaseJson(long packageSize, long checksumSize, string tag = "v0.1.19", bool draft = false, bool prerelease = false, string assetName = "VideoSkillWorkbench-0.1.19-Windows-x64.zip", bool includeChecksum = true, string url = null, string state = "uploaded")
    {
        const string prefix = "https://github.com/kobong1965/video-skill-workbench/releases/download/v0.1.19/";
        var assets = new System.Collections.Generic.List<object> { new { name = assetName, browser_download_url = url ?? prefix + assetName, size = packageSize, state } };
        if (includeChecksum) assets.Add(new { name = "SHA256SUMS.txt", browser_download_url = prefix + "SHA256SUMS.txt", size = checksumSize, state = "uploaded" });
        return JsonSerializer.Serialize(new { tag_name = tag, draft, prerelease, body = "离线测试说明", assets });
    }
    private sealed class ReleaseHandler : HttpMessageHandler
    {
        private readonly byte[] package, sums;
        private readonly long? declared;
        private readonly Func<Stream> packageStream;
        internal ReleaseHandler(byte[] package, byte[] sums, long? declared = null, Func<Stream> packageStream = null) { this.package = package; this.sums = sums; this.declared = declared; this.packageStream = packageStream; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            if (request.Method != HttpMethod.Get) throw new Exception("更新功能发送了非 GET 请求");
            bool checksum = request.RequestUri.AbsolutePath.EndsWith("/SHA256SUMS.txt", StringComparison.Ordinal);
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = !checksum && packageStream != null ? new StreamContent(packageStream()) : new ByteArrayContent(checksum ? sums : package) };
            if (!checksum && declared.HasValue) response.Content.Headers.ContentLength = declared.Value;
            return Task.FromResult(response);
        }
    }
    private sealed class CancelAfterChunkStream : MemoryStream
    {
        private readonly Action cancelAfterWrite;
        private bool firstRead = true;
        internal CancelAfterChunkStream(byte[] content, Action cancelAfterWrite) : base(content, false) { this.cancelAfterWrite = cancelAfterWrite; }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellation = default)
        {
            if (firstRead) { firstRead = false; return base.ReadAsync(buffer.Slice(0, Math.Min(buffer.Length, 81920)), cancellation); }
            cancelAfterWrite();
            cancellation.ThrowIfCancellationRequested();
            throw new Exception("首个数据块写入后未中止读取");
        }
    }
    private sealed class TestFrame : FramelessWindow {
        internal TestFrame() { Width = 1440; Height = 950; ShowInTaskbar = false; Opacity = 0; InstallWindowChrome(new ContextMenuStrip()); }
    }
}
