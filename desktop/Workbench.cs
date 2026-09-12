using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Linq;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Runtime.Versioning;
using System.Threading;
using System.Threading.Tasks;
using System.Text;
using System.Security.Cryptography;
using System.Windows.Forms;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("视频 Skill 工作台")]
[assembly: AssemblyVersion("0.1.6.0")]
[assembly: AssemblyFileVersion("0.1.6.0")]
[assembly: SupportedOSPlatform("windows")]

internal static class Program
{
    internal const string WorkRoot = @"E:\Codex工作盘";
    internal static readonly string DataRoot = Path.Combine(WorkRoot, @"projects\video-skill-workbench-data");
    internal const string Origin = "http://127.0.0.1:4178";
    internal static EventWaitHandle ActivateEvent;
    internal static void ConfigureDisplay()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetDefaultFont(new Font("Microsoft YaHei UI", 12, FontStyle.Regular, GraphicsUnit.Point));
    }
    [STAThread] static void Main(string[] args)
    {
        ConfigureDisplay();
        if (!Directory.Exists(WorkRoot)) { MessageBox.Show("此版本的数据固定保存在 E:\\Codex工作盘，请先确认 E 盘可用。", "无法启动"); return; }
        Directory.CreateDirectory(DataRoot);
        string temp = Path.Combine(WorkRoot, @"temp\video-skill-workbench\desktop");
        Directory.CreateDirectory(temp);
        Environment.SetEnvironmentVariable("TEMP", temp);
        Environment.SetEnvironmentVariable("TMP", temp);
        bool created;
        using (var mutex = new Mutex(true, @"Local\VideoSkillWorkbenchDesktop", out created))
        using (ActivateEvent = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\VideoSkillWorkbenchActivate"))
        {
            if (!created) { ActivateEvent.Set(); return; }
            Application.Run(new WorkbenchWindow());
        }
    }
}

internal sealed class WorkbenchWindow : FramelessWindow
{
    private readonly WebView2 view = new WebView2();
    private readonly Label status = new Label();
    private readonly Button retry = new Button();
    private readonly System.Windows.Forms.Timer activation = new System.Windows.Forms.Timer();
    private bool loading;
    private bool closingApproved;
    private bool checkingClose;
    private static readonly HttpClient healthClient = new HttpClient(new SocketsHttpHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(2) };
    private readonly string downloadRoot = Path.Combine(Program.WorkRoot, @"artifacts\latest\video-skill-workbench\用户导出");

    public WorkbenchWindow()
    {
        Text = "视频 Skill 工作台";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        Width = 1600; Height = 1000;
        MinimumSize = new Size(800, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.White;
        var menu = new ContextMenuStrip { Font = new Font("Microsoft YaHei UI", 12, FontStyle.Regular), Padding = new Padding(4) };
        menu.Items.Add("打开导出文件夹", null, delegate { OpenFolder(downloadRoot); });
        menu.Items.Add("打开数据文件夹", null, delegate { OpenFolder(Program.DataRoot); });
        menu.Items.Add("首次安装码", null, delegate {
            var file = Path.Combine(Program.DataRoot, "本机安装码.txt");
            if (File.Exists(file)) Process.Start(new ProcessStartInfo("notepad.exe", "\"" + file + "\"") { UseShellExecute = true });
            else MessageBox.Show(this, "后台启动完成后会生成安装码。已有账号直接登录即可。", "首次使用");
        });
        menu.Items.Add("刷新", null, delegate { if (view.CoreWebView2 != null) view.Reload(); });
        menu.Items.Add("使用说明", null, delegate { MessageBox.Show(this, "上传商品 → 选择脚本 → 生成提示词\n\n点击脚本卡片右侧缩略图，播放效果视频或放大参考图片，不改变已选脚本。\n上传区可拖入文件，也可点击选择。商品图支持多张；其他入口每次一个文件。\n拖动顶部空白移动窗口，双击可最大化或还原，边缘可缩放。\n\n首次使用：设置管理员，导入脚本，在管理设置中配置文字接口和额度。\n关闭窗口后，后台任务可以继续；重新打开查看进度。\n本机版不支持远程共享。真实 AI 生成仍需要外部 API。\n\n版本 0.1.6 · 数据保存在 E 盘", "使用说明"); }); 
        view.Dock = DockStyle.Fill; view.Visible = false;
        status.Dock = DockStyle.Fill; status.TextAlign = ContentAlignment.MiddleCenter;
        status.Font = new Font("Microsoft YaHei UI", 13); status.Text = "正在打开工作台…\n现有账号、素材和记录将继续保留。";
        retry.Text = "重试打开"; retry.Dock = DockStyle.Bottom; retry.Height = 44; retry.Visible = false;
        retry.Click += async delegate { await Initialize(); };
        Controls.Add(view); Controls.Add(status); Controls.Add(retry);
        InstallWindowChrome(menu);
        activation.Interval = 250;
        activation.Tick += delegate { if (Program.ActivateEvent.WaitOne(0)) { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); } };
        activation.Start();
        Shown += async delegate { await Initialize(); };
        FormClosing += async delegate(object sender, FormClosingEventArgs e) {
            if (closingApproved || view.CoreWebView2 == null || e.CloseReason != CloseReason.UserClosing) return;
            e.Cancel = true;
            if (checkingClose) return;
            checkingClose = true;
            try {
                var result = await view.ExecuteScriptAsync("window.dispatchEvent(new Event('beforeunload', {cancelable:true}))");
                if (result == "false" && MessageBox.Show(this, "还有输入未保存。要继续关闭吗？\n选择“否”可以返回页面等待自动保存，或点击保存草稿。", "确认关闭", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
                closingApproved = true; Close();
            } catch {
                if (MessageBox.Show(this, "暂时无法确认保存状态。仍要关闭窗口吗？已保存的数据和后台任务不会被删除。", "确认关闭", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes) { closingApproved = true; Close(); }
            } finally { checkingClose = false; }
        };
        FormClosed += delegate { activation.Stop(); view.Dispose(); };
    }
    private void OpenFolder(string folder)
    {
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo("explorer.exe", "\"" + folder + "\"") { UseShellExecute = true });
    }
    private async Task<bool> Healthy()
    {
        // Windows may delay async HTTP connection-refused errors beyond the
        // response deadline. Check the local listener table first; an absent
        // listener is different from an existing but slow/foreign service.
        if (!PortIsListening(4178)) return false;
        try
        {
            string challenge = Guid.NewGuid().ToString("N");
            using (var response = await healthClient.GetAsync(Program.Origin + "/api/health?challenge=" + challenge))
            {
                response.EnsureSuccessStatusCode();
                var json = JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, JsonElement>>(await response.Content.ReadAsStringAsync());
                var release = JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, JsonElement>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "release.json")));
                if (json == null || release == null || !json.ContainsKey("application") || json["application"].GetString() != "video-skill-workbench" || !json.ContainsKey("desktopRelease") || json["desktopRelease"].GetString() != release["id"].GetString() || !json.ContainsKey("proof"))
                    throw new Exception("检测到旧版后台或其他服务占用本机端口。请先保存并完成旧版任务，重启电脑后再打开此 Windows 版。账号和素材不会因此删除。");
                var secrets = JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, JsonElement>>(File.ReadAllText(Path.Combine(Program.DataRoot, "local-secrets.json")));
                string hex = secrets["masterKey"].GetString();
                var key = new byte[hex.Length / 2];
                for (int i = 0; i < key.Length; i++) key[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
                string expected;
                using (var hmac = new HMACSHA256(key)) expected = Convert.ToHexStringLower(hmac.ComputeHash(Encoding.UTF8.GetBytes("video-skill-workbench|" + release["id"].GetString() + "|" + challenge)));
                if (json["proof"].GetString() != expected) throw new Exception("后台身份验证不通过，已阻止连接。请查看数据目录配置，不要删除现有资料。");
                return true;
            }
        }
        catch (OperationCanceledException) { throw new Exception("本机端口上的服务没有及时响应。请稍后重试，不会重复启动后台。"); }
        catch (HttpRequestException) { if (!PortIsListening(4178)) return false; throw new Exception("已有本机服务未通过连接检查。请稍后重试或查看 logs。"); }
    }
    private async Task Initialize()
    {
        if (loading) return;
        loading = true; retry.Visible = false;
        try
        {
            if (!await Healthy())
            {
                var script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "start-service.ps1");
                if (!File.Exists(script)) throw new Exception("程序文件不完整，请解压完整软件包后重新打开。");
                var info = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -DataRoot \"" + Program.DataRoot + "\"") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
                using (var process = Process.Start(info))
                {
                    await Task.Run(delegate { if (!process.WaitForExit(15000)) throw new Exception("后台启动超过等待时间，请稍后重试。"); });
                    if (process.ExitCode != 0) throw new Exception("后台启动失败，请查看数据文件夹中的 logs。数据没有被重置。");
                }
                bool ready = false;
                for (int attempt = 0; attempt < 90; attempt++) { if (await Healthy()) { ready = true; break; } await Task.Delay(500); }
                if (!ready) throw new Exception("后台尚未就绪。请查看数据文件夹中的 logs，再重试打开。原有数据仍保留。");
            }
            if (view.CoreWebView2 == null)
            {
                string profile = Path.Combine(Program.DataRoot, "desktop-profile");
                Directory.CreateDirectory(profile); Directory.CreateDirectory(downloadRoot);
                var options = new CoreWebView2EnvironmentOptions(); options.Language = "zh-CN";
                var environment = await CoreWebView2Environment.CreateAsync(null, profile, options);
                await view.EnsureCoreWebView2Async(environment);
                view.AllowExternalDrop = true;
                await view.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("document.addEventListener('DOMContentLoaded', function () { document.documentElement.dataset.desktop = 'true'; });");
                view.CoreWebView2.Settings.AreDevToolsEnabled = false;
                view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                view.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
                view.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
                view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                view.CoreWebView2.Settings.AreHostObjectsAllowed = false;
                view.CoreWebView2.Settings.IsWebMessageEnabled = false;
                view.CoreWebView2.Profile.DefaultDownloadFolderPath = downloadRoot;
                view.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) { if (!Allowed(e.Uri)) e.Cancel = true; };
                view.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
                view.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
                view.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) {
                    string file = Path.GetFileName(e.ResultFilePath);
                    if (string.IsNullOrWhiteSpace(file)) file = "工作台导出.zip";
                    e.ResultFilePath = Path.Combine(downloadRoot, DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" + file);
                };
                view.CoreWebView2.ProcessFailed += delegate { status.Text = "软件显示进程已停止。点击重试恢复；数据未被清空。"; status.Visible = true; view.Visible = false; retry.Visible = true; };
            }
            view.CoreWebView2.Navigate(Program.Origin);
            view.Visible = true; status.Visible = false;
        }
        catch (Exception ex)
        {
            status.Text = "暂时无法打开工作台\n\n" + ex.Message + (ex is WebView2RuntimeNotFoundException ? "\n\n这台电脑缺少 Microsoft WebView2；不会自动安装系统组件。" : "\n\n可以稍后重试，原有资料仍然保留。");
            status.Visible = true; view.Visible = false; retry.Visible = true;
        }
        finally { loading = false; }
    }
    internal static bool Allowed(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 4178 && string.IsNullOrEmpty(uri.UserInfo);
    }
    internal static bool PortIsListening(int port)
    {
        return IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint => endpoint.Port == port);
    }
}
