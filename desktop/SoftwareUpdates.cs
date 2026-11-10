using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class SoftwareReleaseAsset
{
    internal string Name { get; }
    internal Uri Url { get; }
    internal long Size { get; }
    internal SoftwareReleaseAsset(string name, Uri url, long size) { Name = name; Url = url; Size = size; }
}

internal sealed class SoftwareRelease
{
    internal Version Version { get; }
    internal string Notes { get; }
    internal SoftwareReleaseAsset Package { get; }
    internal SoftwareReleaseAsset Checksums { get; }
    internal SoftwareRelease(Version version, string notes, SoftwareReleaseAsset package, SoftwareReleaseAsset checksums)
    { Version = version; Notes = notes; Package = package; Checksums = checksums; }
}

// This updater only GETs public release metadata/assets. It never reads application
// accounts, Skill content, model configuration, or background-task state.
internal static class SoftwareUpdates
{
    internal const string LatestUrl = "https://api.github.com/repos/kobong1965/video-skill-workbench/releases/latest";
    internal const long MaximumPackageBytes = 2L * 1024 * 1024 * 1024;
    internal const long MaximumChecksumBytes = 1024 * 1024;
    private const long MaximumMetadataBytes = 2 * 1024 * 1024;
    private const string DownloadPrefix = "https://github.com/kobong1965/video-skill-workbench/releases/download/v";
    private static readonly HttpClient client = new HttpClient(new SocketsHttpHandler {
        AllowAutoRedirect = false, UseCookies = false, Credentials = null, ConnectTimeout = TimeSpan.FromSeconds(20)
    }) { Timeout = Timeout.InfiniteTimeSpan };

    internal static bool TryVersion(string text, out Version version)
    {
        version = null;
        if (text == null || text.Length > 64 || !Regex.IsMatch(text, @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z")) return false;
        string[] parts = text.Split('.');
        int major, minor, patch;
        if (!int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out major) ||
            !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out minor) ||
            !int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out patch)) return false;
        version = new Version(major, minor, patch); return true;
    }

    internal static Version ParseLocalVersion(string json)
    {
        using (var document = JsonDocument.Parse(json)) {
            JsonElement value;
            Version version;
            if (!document.RootElement.TryGetProperty("version", out value) || value.ValueKind != JsonValueKind.String || !TryVersion(value.GetString(), out version))
                throw new InvalidDataException("本机 release.json 中的版本号无效。");
            return version;
        }
    }

    internal static Version ReadCurrentVersion(string programDirectory)
    {
        try {
            string path = Path.Combine(programDirectory, "release.json");
            if (new FileInfo(path).Length > 16384) return null;
            return ParseLocalVersion(File.ReadAllText(path));
        } catch (Exception error) when (error is IOException || error is UnauthorizedAccessException || error is JsonException || error is InvalidOperationException) { return null; }
    }

    internal static bool IsNewer(Version current, Version latest) => current != null && latest != null && latest.CompareTo(current) > 0;
    internal static string PackageName(Version version) => "VideoSkillWorkbench-" + version.ToString(3) + "-Windows-x64.zip";

    internal static bool AllowedAssetUrl(string address, Version version, string name)
    {
        return version != null && (name == PackageName(version) || name == "SHA256SUMS.txt") &&
            string.Equals(address, DownloadPrefix + version.ToString(3) + "/" + name, StringComparison.Ordinal);
    }

    private static string RequiredString(JsonElement element, string key)
    {
        JsonElement value;
        if (!element.TryGetProperty(key, out value) || value.ValueKind != JsonValueKind.String) throw new InvalidDataException("版本信息缺少有效的 " + key + "。");
        return value.GetString();
    }

    internal static SoftwareRelease ParseRelease(string json)
    {
        using (var document = JsonDocument.Parse(json)) {
            var root = document.RootElement;
            JsonElement draft, prerelease, assets;
            if (!root.TryGetProperty("draft", out draft) || draft.ValueKind != JsonValueKind.False ||
                !root.TryGetProperty("prerelease", out prerelease) || prerelease.ValueKind != JsonValueKind.False)
                throw new InvalidDataException("仅支持已正式发布的稳定版本。");
            string tag = RequiredString(root, "tag_name");
            Version version;
            if (!tag.StartsWith("v", StringComparison.Ordinal) || !TryVersion(tag.Substring(1), out version))
                throw new InvalidDataException("发布标签必须是 v 开头的三段数字版本号。");
            if (!root.TryGetProperty("assets", out assets) || assets.ValueKind != JsonValueKind.Array) throw new InvalidDataException("发布版本缺少下载文件。");
            string packageName = PackageName(version);
            SoftwareReleaseAsset package = null, checksums = null;
            foreach (var asset in assets.EnumerateArray()) {
                string name = RequiredString(asset, "name");
                if (name != packageName && name != "SHA256SUMS.txt") continue;
                if ((name == packageName && package != null) || (name == "SHA256SUMS.txt" && checksums != null)) throw new InvalidDataException("发布版本包含重名文件，已停止下载。");
                string url = RequiredString(asset, "browser_download_url");
                if (!AllowedAssetUrl(url, version, name)) throw new InvalidDataException("下载地址不属于此仓库对应版本，已停止下载。");
                JsonElement length;
                long size;
                long maximum = name == packageName ? MaximumPackageBytes : MaximumChecksumBytes;
                if (RequiredString(asset, "state") != "uploaded" || !asset.TryGetProperty("size", out length) || !length.TryGetInt64(out size) || size <= 0 || size > maximum)
                    throw new InvalidDataException("发布文件尚未上传完整或超过允许大小。");
                var validated = new SoftwareReleaseAsset(name, new Uri(url), size);
                if (name == packageName) package = validated; else checksums = validated;
            }
            if (package == null || checksums == null) throw new InvalidDataException("此版本尚未提供标准 Windows 软件包及 SHA256SUMS.txt，请稍后检查。");
            JsonElement body;
            string notes = root.TryGetProperty("body", out body) && body.ValueKind == JsonValueKind.String ? body.GetString() : "";
            if (notes.Length > 32000) notes = notes.Substring(0, 32000) + "\r\n（更新说明过长，已截断显示。）";
            return new SoftwareRelease(version, notes, package, checksums);
        }
    }

    internal static string FindChecksum(string text, string exactFileName)
    {
        string found = null;
        foreach (string raw in text.TrimStart('\uFEFF').Split('\n')) {
            string line = raw.TrimEnd('\r');
            // sha256sum's text/binary marker is part of the format; paths,
            // prefixes and similar filenames must never match the package.
            var match = Regex.Match(line, @"\A([a-fA-F0-9]{64}) [ *](.+)\z");
            if (!match.Success || !string.Equals(match.Groups[2].Value, exactFileName, StringComparison.Ordinal)) continue;
            if (found != null) throw new InvalidDataException("校验清单中的软件包文件名重复。");
            found = match.Groups[1].Value.ToLowerInvariant();
        }
        if (found == null) throw new InvalidDataException("校验清单中没有对应软件包的 SHA-256，已停止下载。");
        return found;
    }

    internal static bool AllowedRedirect(Uri uri, SoftwareReleaseAsset asset)
    {
        if (uri == null || uri.Scheme != "https" || uri.Port != 443 || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) return false;
        if (uri.Host == "github.com") return uri.AbsoluteUri == asset.Url.AbsoluteUri;
        return uri.Host == "release-assets.githubusercontent.com" || uri.Host == "objects.githubusercontent.com";
    }

    private static async Task<HttpResponseMessage> GetAsync(HttpClient http, Uri address, SoftwareReleaseAsset asset, CancellationToken cancellation)
    {
        Uri target = address;
        for (int redirects = 0; redirects <= 5; redirects++) {
            using (var request = new HttpRequestMessage(HttpMethod.Get, target)) {
                request.Headers.UserAgent.ParseAdd("VideoSkillWorkbench-UpdateChecker");
                request.Headers.Accept.ParseAdd(asset == null ? "application/vnd.github+json" : "application/octet-stream");
                if (asset == null) request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
                HttpResponseMessage response;
                using (var headersTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
                    headersTimeout.CancelAfter(TimeSpan.FromSeconds(30));
                    response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, headersTimeout.Token).ConfigureAwait(false);
                }
                int code = (int)response.StatusCode;
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    Uri location = response.Headers.Location;
                    response.Dispose();
                    if (location == null || !Uri.TryCreate(target, location, out target) || asset == null || !AllowedRedirect(target, asset) || redirects == 5)
                        throw new InvalidDataException("下载重定向地址不受支持，已停止下载。");
                    continue;
                }
                if (response.StatusCode != HttpStatusCode.OK) {
                    response.Dispose();
                    throw new HttpRequestException("GitHub 请求失败。", null, (HttpStatusCode)code);
                }
                return response;
            }
        }
        throw new InvalidDataException("下载重定向次数过多。");
    }

    private static async Task<long> CopyLimitedAsync(Stream input, Stream output, long maximum, long? expected, IProgress<int> progress, CancellationToken cancellation)
    {
        byte[] buffer = new byte[81920];
        long total = 0;
        int lastPercent = -1;
        while (true) {
            int read;
            using (var idle = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
                idle.CancelAfter(TimeSpan.FromSeconds(60));
                read = await input.ReadAsync(buffer.AsMemory(), idle.Token).ConfigureAwait(false);
            }
            if (read == 0) break;
            total += read;
            if (total > maximum || (expected.HasValue && total > expected.Value)) throw new InvalidDataException("下载文件大小与发布信息不符。");
            await output.WriteAsync(buffer.AsMemory(0, read), cancellation).ConfigureAwait(false);
            int percent = expected.HasValue ? (int)(total * 100 / expected.Value) : 0;
            if (percent != lastPercent) { progress?.Report(percent); lastPercent = percent; }
        }
        if (expected.HasValue && total != expected.Value) throw new InvalidDataException("文件没有下载完整，请重试。");
        return total;
    }

    private static async Task<string> ReadTextAsync(HttpClient http, Uri address, SoftwareReleaseAsset asset, long maximum, CancellationToken cancellation)
    {
        using (var response = await GetAsync(http, address, asset, cancellation).ConfigureAwait(false)) {
            long? length = response.Content.Headers.ContentLength;
            if ((length.HasValue && length.Value > maximum) || (asset != null && length.HasValue && length.Value != asset.Size)) throw new InvalidDataException("文件大小与发布信息不符。");
            using (var input = await response.Content.ReadAsStreamAsync(cancellation).ConfigureAwait(false))
            using (var memory = new MemoryStream()) {
                await CopyLimitedAsync(input, memory, maximum, asset == null ? length : asset.Size, null, cancellation).ConfigureAwait(false);
                return Encoding.UTF8.GetString(memory.ToArray());
            }
        }
    }

    internal static async Task<SoftwareRelease> CheckAsync(CancellationToken cancellation)
    {
        using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
            deadline.CancelAfter(TimeSpan.FromSeconds(45));
            return ParseRelease(await ReadTextAsync(client, new Uri(LatestUrl), null, MaximumMetadataBytes, deadline.Token).ConfigureAwait(false));
        }
    }

    internal static Task<string> DownloadAsync(SoftwareRelease release, Version current, string root, IProgress<int> progress, CancellationToken cancellation)
        => DownloadAsync(client, release, current, root, progress, cancellation);

    // HttpClient injection permits tests with in-memory responses and no network.
    internal static async Task<string> DownloadAsync(HttpClient http, SoftwareRelease release, Version current, string root, IProgress<int> progress, CancellationToken cancellation)
    {
        if (!IsNewer(current, release.Version)) throw new InvalidDataException("只允许下载比当前版本更新的正式版本。");
        if (!AllowedAssetUrl(release.Package.Url.AbsoluteUri, release.Version, release.Package.Name) ||
            !AllowedAssetUrl(release.Checksums.Url.AbsoluteUri, release.Version, release.Checksums.Name)) throw new InvalidDataException("下载地址不属于此仓库对应版本。");
        string folder = null, partial = null;
        try {
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
                deadline.CancelAfter(TimeSpan.FromMinutes(30));
                string sums = await ReadTextAsync(http, release.Checksums.Url, release.Checksums, MaximumChecksumBytes, deadline.Token).ConfigureAwait(false);
                string expected = FindChecksum(sums, release.Package.Name);
                folder = Path.Combine(root, "v" + release.Version.ToString(3) + "-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(folder);
                string destination = Path.Combine(folder, release.Package.Name);
                partial = destination + ".partial";
                using (var response = await GetAsync(http, release.Package.Url, release.Package, deadline.Token).ConfigureAwait(false)) {
                    long? length = response.Content.Headers.ContentLength;
                    if (release.Package.Size <= 0 || release.Package.Size > MaximumPackageBytes || (length.HasValue && length.Value != release.Package.Size)) throw new InvalidDataException("软件包大小与发布信息不符。");
                    using (var input = await response.Content.ReadAsStreamAsync(deadline.Token).ConfigureAwait(false))
                    using (var output = new FileStream(partial, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 81920, FileOptions.Asynchronous)) {
                        await CopyLimitedAsync(input, output, MaximumPackageBytes, release.Package.Size, progress, deadline.Token).ConfigureAwait(false);
                        await output.FlushAsync(deadline.Token).ConfigureAwait(false);
                        progress?.Report(100);
                        output.Position = 0;
                        string actual = Convert.ToHexStringLower(await SHA256.HashDataAsync(output, deadline.Token).ConfigureAwait(false));
                        if (!string.Equals(expected, actual, StringComparison.Ordinal)) throw new InvalidDataException("SHA-256 校验失败，下载文件已丢弃。请稍后重试。");
                    }
                }
                deadline.Token.ThrowIfCancellationRequested();
                File.Move(partial, destination); // No overwrite; only a verified complete file receives .zip.
                return destination;
            }
        } finally {
            if (partial != null) { try { File.Delete(partial); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
            if (folder != null) { try { Directory.Delete(folder, false); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
        }
    }
}

internal sealed class SoftwareUpdateWindow : Form
{
    internal const string InstallGuidance = @"下载后请先完成当前任务并保存。将新版完整解压到 E:\Codex工作盘\ 下的独立程序目录；确认旧版后台已退出，或重启电脑后，再启动新版。数据目录沿用不变。";
    private readonly Label versions = new Label { Dock = DockStyle.Fill, AutoSize = true };
    private readonly Label state = new Label { Dock = DockStyle.Fill, AutoSize = true };
    private readonly TextBox notes = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White };
    private readonly Button check = new Button { Text = "重新检查", AutoSize = true };
    private readonly Button download = new Button { Text = "下载并校验软件包", AutoSize = true, Enabled = false };
    private readonly Button cancel = new Button { Text = "取消", AutoSize = true, Enabled = false };
    private readonly Button folder = new Button { Text = "打开下载文件夹", AutoSize = true, Enabled = false };
    private readonly Version current;
    private CancellationTokenSource operation;
    private SoftwareRelease available;
    private string downloaded;
    private bool busy;

    internal SoftwareUpdateWindow(Version currentVersion)
    {
        current = currentVersion;
        Text = "检查版本更新"; Font = new Font("Microsoft YaHei UI", 11);
        AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96, 96);
        Size = new Size(760, 670); MinimumSize = new Size(620, 540);
        StartPosition = FormStartPosition.CenterParent;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 1, RowCount = 6 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        versions.Margin = new Padding(0, 0, 0, 12);
        layout.Controls.Add(versions, 0, 0);
        layout.Controls.Add(new Label { Text = "更新说明", AutoSize = true, Margin = new Padding(0, 0, 0, 6) }, 0, 1);
        layout.Controls.Add(notes, 0, 2);
        layout.Controls.Add(state, 0, 3);
        var guidance = new Label { Text = "仅下载并校验 Windows 软件包，不自动安装。现有脚本、素材和本机配置继续保留，不随更新上传。\r\n" + InstallGuidance, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 12, 0, 12) };
        layout.Controls.Add(guidance, 0, 4);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, WrapContents = true };
        buttons.Controls.AddRange(new Control[] { check, download, cancel, folder });
        layout.Controls.Add(buttons, 0, 5); Controls.Add(layout);
        check.Click += async delegate { await Check(); };
        download.Click += async delegate { await Download(); };
        cancel.Click += delegate { operation?.Cancel(); };
        folder.Click += delegate {
            if (downloaded == null || !File.Exists(downloaded)) return;
            try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + Path.GetDirectoryName(downloaded) + "\"") { UseShellExecute = true }); }
            catch (Exception error) when (error is System.ComponentModel.Win32Exception || error is InvalidOperationException) { state.Text = "无法自动打开文件夹，文件仍保存在：" + downloaded; }
        };
        Shown += async delegate { await Check(); };
        FormClosing += delegate { operation?.Cancel(); };
        ShowVersions();
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var work = Screen.FromHandle(Handle).WorkingArea;
        int margin = FramelessWindow.AtDpi(20, DeviceDpi);
        int width = Math.Min(FramelessWindow.AtDpi(760, DeviceDpi), Math.Max(1, work.Width - margin * 2));
        int height = Math.Min(FramelessWindow.AtDpi(670, DeviceDpi), Math.Max(1, work.Height - margin * 2));
        MinimumSize = new Size(Math.Min(FramelessWindow.AtDpi(620, DeviceDpi), width), Math.Min(FramelessWindow.AtDpi(540, DeviceDpi), height));
        Bounds = new Rectangle(work.Left + (work.Width - width) / 2, work.Top + (work.Height - height) / 2, width, height);
    }

    private void ShowVersions()
    {
        versions.Text = "当前版本：" + (current == null ? "无法读取 release.json" : current.ToString(3)) + "    最新正式版：" + (available == null ? "尚未检查" : available.Version.ToString(3));
    }
    private void BeginOperation()
    {
        busy = true; check.Enabled = false; download.Enabled = false; cancel.Enabled = true;
        operation = new CancellationTokenSource();
    }
    private void EndOperation()
    {
        operation.Dispose(); operation = null; busy = false;
        if (IsDisposed) return;
        check.Enabled = true; cancel.Enabled = false;
        download.Enabled = available != null && SoftwareUpdates.IsNewer(current, available.Version);
    }
    private string ErrorMessage(Exception error)
    {
        if (error is OperationCanceledException) return operation.IsCancellationRequested ? "已取消；未完成的下载不会作为完整包保留。" : "网络请求超时，请稍后重试。";
        if (error is JsonException || error is InvalidOperationException) return "GitHub 返回的版本信息格式无效，请稍后重试。";
        if (error is HttpRequestException http) {
            if (http.StatusCode == HttpStatusCode.NotFound) return "尚无可用的正式发布版本或文件，请稍后检查。";
            if (http.StatusCode == HttpStatusCode.Forbidden || http.StatusCode == HttpStatusCode.TooManyRequests) return "GitHub 暂时限制了请求次数，请稍后重试。";
            return "暂时无法连接 GitHub，请检查网络后重试。";
        }
        if (error is InvalidDataException) return error.Message;
        if (error is UnauthorizedAccessException) return "没有写入 E 盘下载目录的权限，请检查文件夹权限后重试。";
        if (error is IOException) return "网络或文件读取失败，请检查网络、E 盘空间和文件夹权限后重试。";
        return "操作暂时未能完成，请稍后重试。";
    }
    private async Task Check()
    {
        if (busy) return;
        BeginOperation(); available = null; notes.Clear(); ShowVersions(); state.Text = "正在从 GitHub 检查正式版本…";
        try {
            var release = await SoftwareUpdates.CheckAsync(operation.Token);
            if (IsDisposed) return;
            available = release; ShowVersions(); notes.Text = string.IsNullOrWhiteSpace(release.Notes) ? "此版本没有填写更新说明。" : release.Notes.Replace("\n", "\r\n").Replace("\r\r\n", "\r\n");
            state.Text = current == null ? "无法确认当前版本，已禁用下载。请检查完整软件包中的 release.json。" :
                SoftwareUpdates.IsNewer(current, release.Version) ? "发现新版本，可下载完整软件包并校验。工作台和后台任务可继续运行。" :
                release.Version == current ? "当前已是最新正式版本。" : "当前版本高于最新正式版，无需下载旧版。";
        } catch (Exception error) { if (!IsDisposed) state.Text = "检查未完成：" + ErrorMessage(error); }
        finally { EndOperation(); }
    }
    private async Task Download()
    {
        if (busy || available == null || !SoftwareUpdates.IsNewer(current, available.Version)) return;
        BeginOperation(); folder.Enabled = false; state.Text = "正在下载并检查校验清单…";
        var activeOperation = operation;
        var progress = new Progress<int>(percent => { if (!IsDisposed && operation == activeOperation) state.Text = percent < 100 ? "正在下载软件包：" + percent + "%" : "软件包已收齐，正在验证 SHA-256…"; });
        try {
            downloaded = await SoftwareUpdates.DownloadAsync(available, current, Path.Combine(Program.WorkRoot, @"artifacts\software-updates"), progress, operation.Token);
            if (IsDisposed) return;
            state.Text = "下载完成，SHA-256 校验通过。\r\n保存位置：" + downloaded;
            folder.Enabled = true;
        } catch (Exception error) { if (!IsDisposed) { state.Text = "下载未完成：" + ErrorMessage(error); folder.Enabled = downloaded != null && File.Exists(downloaded); } }
        finally { EndOperation(); }
    }
}
