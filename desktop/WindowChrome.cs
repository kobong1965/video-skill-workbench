using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal class FramelessWindow : Form
{
    private const int Grip = 6;
    private Button maximize;
    private Panel titleBar;
    private Label titleLabel;
    private PictureBox brandImage;
    private ContextMenuStrip windowMenu;
    private bool activeFrame;
    private Rectangle restoreBounds;
    private FormWindowState previousState = FormWindowState.Normal;
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr handle, ref FrameMargins margins);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr handle, int attribute, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)] private struct FrameMargins { public int Left, Right, Top, Bottom; }
    internal static int AtDpi(int logical, int dpi) => (int)Math.Round(logical * Math.Max(96, dpi) / 96d, MidpointRounding.AwayFromZero);
    internal static Rectangle InitialBounds(Rectangle work, int dpi)
    {
        int margin = AtDpi(24, dpi);
        int width = Math.Min(AtDpi(1600, dpi), Math.Max(1, work.Width - margin * 2));
        int height = Math.Min(AtDpi(1000, dpi), Math.Max(1, work.Height - margin * 2));
        return new Rectangle(work.Left + (work.Width - width) / 2, work.Top + (work.Height - height) / 2, width, height);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var initial = InitialBounds(Screen.FromHandle(Handle).WorkingArea, DeviceDpi);
        MinimumSize = new Size(Math.Min(AtDpi(800, DeviceDpi), initial.Width), Math.Min(AtDpi(560, DeviceDpi), initial.Height));
        if (WindowState == FormWindowState.Normal) Bounds = initial;
        ApplyChromeMetrics();
    }

    protected FramelessWindow()
    {
        FormBorderStyle = FormBorderStyle.None;
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.White;
        Padding = new Padding(Grip);
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw, true);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyChromeMetrics();
        // DWM supplies the real window shadow. The client outline remains available
        // even if composition is unavailable or disabled by a remote session.
        try {
            var margins = new FrameMargins { Left = 1, Right = 1, Top = 1, Bottom = 1 };
            DwmExtendFrameIntoClientArea(Handle, ref margins);
            int rounded = 2;
            DwmSetWindowAttribute(Handle, 33, ref rounded, sizeof(int));
        } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
    }

    private void ApplyChromeMetrics()
    {
        int dpi = DeviceDpi;
        Padding = new Padding(WindowState == FormWindowState.Maximized ? 0 : AtDpi(Grip, dpi));
        if (titleBar == null) return;
        titleBar.Height = AtDpi(48, dpi);
        titleLabel.Width = AtDpi(288, dpi);
        brandImage.Width = AtDpi(52, dpi);
        brandImage.Padding = new Padding(AtDpi(12, dpi), AtDpi(8, dpi), AtDpi(12, dpi), AtDpi(8, dpi));
        foreach (Control control in titleBar.Controls)
            if (control is Button) control.Width = AtDpi(52, dpi);
        foreach (ToolStripItem item in windowMenu.Items) item.Padding = new Padding(AtDpi(8, dpi), AtDpi(6, dpi), AtDpi(8, dpi), AtDpi(6, dpi));
        Invalidate(); titleBar.Invalidate();
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        ApplyChromeMetrics();
        if (WindowState == FormWindowState.Normal) restoreBounds = Bounds;
        else if (!restoreBounds.IsEmpty) {
            var work = Screen.FromHandle(Handle).WorkingArea;
            int width = Math.Min(work.Width, (int)Math.Round(restoreBounds.Width * e.DeviceDpiNew / (double)e.DeviceDpiOld));
            int height = Math.Min(work.Height, (int)Math.Round(restoreBounds.Height * e.DeviceDpiNew / (double)e.DeviceDpiOld));
            restoreBounds = new Rectangle(work.Left + (work.Width - width) / 2, work.Top + (work.Height - height) / 2, width, height);
        }
    }

    protected override void OnActivated(EventArgs e) { base.OnActivated(e); activeFrame = true; Invalidate(); titleBar?.Invalidate(); }
    protected override void OnDeactivate(EventArgs e) { base.OnDeactivate(e); activeFrame = false; Invalidate(); titleBar?.Invalidate(); }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (WindowState == FormWindowState.Maximized) return;
        float stroke = AtDpi(1, DeviceDpi);
        using var pen = new Pen(activeFrame ? Color.FromArgb(125, 140, 164) : Color.FromArgb(181, 189, 202), stroke);
        float inset = stroke / 2;
        e.Graphics.DrawRectangle(pen, inset, inset, Math.Max(0, ClientSize.Width - stroke), Math.Max(0, ClientSize.Height - stroke));
    }

    protected void InstallWindowChrome(ContextMenuStrip menu)
    {
        windowMenu = menu;
        var bar = titleBar = new Panel { Dock = DockStyle.Top, Height = 48, BackColor = Color.FromArgb(248, 249, 252), Name = "window-titlebar" };
        var title = titleLabel = new Label { Text = "视频 Skill 工作台", Dock = DockStyle.Left, Width = 288, AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.FromArgb(56, 67, 83), Font = new Font("Microsoft YaHei UI", 12) };
        var logo = brandImage = new PictureBox { Name = "window-brand-icon", AccessibleName = "蜗牛标志", Dock = DockStyle.Left, Width = 52, Padding = new Padding(12, 8, 12, 8), SizeMode = PictureBoxSizeMode.Zoom, Image = Icon == null ? null : Icon.ToBitmap(), TabStop = false };
        bar.Paint += (_, e) => { using var pen = new Pen(Color.FromArgb(203, 209, 220), AtDpi(1, DeviceDpi)); e.Graphics.DrawLine(pen, 0, bar.Height - 1, bar.Width, bar.Height - 1); };
        logo.Disposed += delegate { if (logo.Image != null) logo.Image.Dispose(); };
        MouseEventHandler drag = delegate(object sender, MouseEventArgs e) {
            if (e.Button != MouseButtons.Left) return;
            if (e.Clicks == 2) { ToggleMaximize(); return; }
            ReleaseCapture();
            SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero); // Native caption drag, not page dragging.
        };
        bar.MouseDown += drag; title.MouseDown += drag; logo.MouseDown += drag;
        var more = ChromeButton("window-menu", "更多操作", "⋯");
        more.Click += delegate { menu.Show(more, new Point(0, more.Height)); };
        var minimize = ChromeButton("window-minimize", "最小化", "─");
        minimize.Click += delegate {
            if (WindowState == FormWindowState.Normal) restoreBounds = Bounds;
            WindowState = FormWindowState.Minimized;
        };
        maximize = ChromeButton("window-maximize", "最大化", "□");
        maximize.Click += delegate { ToggleMaximize(); };
        var close = ChromeButton("window-close", "关闭窗口", "×");
        close.FlatAppearance.MouseOverBackColor = Color.FromArgb(255, 233, 239);
        close.Click += delegate { Close(); }; // Keeps the existing unsaved-input confirmation.
        bar.Controls.Add(title); bar.Controls.Add(logo); bar.Controls.Add(more); bar.Controls.Add(minimize); bar.Controls.Add(maximize); bar.Controls.Add(close);
        // Docking is evaluated from the back: reserve the titlebar before Fill.
        Controls.Add(bar); bar.SendToBack();
        Resize += delegate {
            var currentState = WindowState;
            if (previousState == FormWindowState.Minimized && currentState == FormWindowState.Normal && !restoreBounds.IsEmpty && IsHandleCreated) {
                var savedBounds = restoreBounds;
                // Restore may come from the taskbar, the app shortcut, or ShowWindow.
                // Apply after WinForms finishes its native-frame size conversion.
                BeginInvoke((Action)delegate { if (!IsDisposed && WindowState == FormWindowState.Normal) Bounds = savedBounds; });
            }
            previousState = currentState;
            bool maximized = WindowState == FormWindowState.Maximized;
            Padding = new Padding(maximized ? 0 : AtDpi(Grip, DeviceDpi));
            maximize.Text = maximized ? "❐" : "□";
            maximize.AccessibleName = maximized ? "还原窗口" : "最大化";
            Invalidate();
        };
        ApplyChromeMetrics();
    }

    private static Button ChromeButton(string name, string accessibleName, string text)
    {
        var button = new Button { Name = name, AccessibleName = accessibleName, AccessibleRole = AccessibleRole.PushButton, Text = text, Dock = DockStyle.Right, Width = 52, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(248, 249, 252), ForeColor = Color.FromArgb(55, 60, 70), Font = new Font("Segoe UI", 14), TabStop = true };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 245, 248);
        return button;
    }

    internal void ToggleMaximize()
    {
        if (WindowState == FormWindowState.Maximized) {
            WindowState = FormWindowState.Normal;
            // WinForms otherwise adds the invisible native resize frame again.
            if (!restoreBounds.IsEmpty) Bounds = restoreBounds;
        } else {
            restoreBounds = Bounds;
            WindowState = FormWindowState.Maximized;
        }
    }

    // Keep native resizing and system-menu keyboard behavior without a painted frame.
    protected override CreateParams CreateParams {
        get { var parameters = base.CreateParams; parameters.Style |= 0x00040000 | 0x00020000 | 0x00010000 | 0x00080000; parameters.Style &= ~0x00C00000; return parameters; }
    }
    internal static int ResizeHit(Point point, Size size, bool maximized, int dpi = 96)
    {
        if (maximized || point.X < 0 || point.Y < 0 || point.X >= size.Width || point.Y >= size.Height) return 1;
        int grip = AtDpi(Grip, dpi);
        bool left = point.X < grip, right = point.X >= size.Width - grip;
        bool top = point.Y < grip, bottom = point.Y >= size.Height - grip;
        if (top && left) return 13; if (top && right) return 14;
        if (bottom && left) return 16; if (bottom && right) return 17;
        if (left) return 10; if (right) return 11; if (top) return 12; if (bottom) return 15;
        return 1;
    }
    internal static Rectangle RelativeWorkArea(Rectangle monitor, Rectangle work)
    {
        return new Rectangle(work.Left - monitor.Left, work.Top - monitor.Top, work.Width, work.Height);
    }
    [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public NativePoint Reserved, MaxSize, MaxPosition, MinTrack, MaxTrack; }
    protected override void WndProc(ref Message message)
    {
        // The whole client is custom-drawn, including when Windows reactivates
        // the window without DWM composition. Never repaint a legacy caption.
        if (message.Msg == 0x0085) { message.Result = IntPtr.Zero; return; }
        if (message.Msg == 0x0086) { message.Result = new IntPtr(1); return; }
        int systemCommand = message.Msg == 0x0112 ? message.WParam.ToInt32() & 0xfff0 : 0;
        if ((systemCommand == 0xf030 || systemCommand == 0xf020) && WindowState == FormWindowState.Normal) restoreBounds = Bounds;
        bool restoring = systemCommand == 0xf120 && WindowState == FormWindowState.Maximized;
        if (message.Msg == 0x0083 && message.WParam != IntPtr.Zero) { message.Result = IntPtr.Zero; return; }
        if (message.Msg == 0x0084) {
            long value = message.LParam.ToInt64();
            var point = PointToClient(new Point(unchecked((short)(value & 0xffff)), unchecked((short)((value >> 16) & 0xffff))));
            int hit = ResizeHit(point, ClientSize, WindowState == FormWindowState.Maximized, DeviceDpi);
            if (hit != 1) { message.Result = new IntPtr(hit); return; }
        }
        if (message.Msg == 0x00A3 && message.WParam.ToInt32() == 2) { ToggleMaximize(); message.Result = IntPtr.Zero; return; }
        base.WndProc(ref message);
        if (restoring && !restoreBounds.IsEmpty) Bounds = restoreBounds;
        if (message.Msg == 0x0024) {
            var monitor = Screen.FromHandle(Handle);
            var work = RelativeWorkArea(monitor.Bounds, monitor.WorkingArea);
            var limits = (MinMaxInfo)Marshal.PtrToStructure(message.LParam, typeof(MinMaxInfo));
            limits.MaxPosition.X = work.X; limits.MaxPosition.Y = work.Y;
            limits.MaxSize.X = work.Width; limits.MaxSize.Y = work.Height;
            limits.MinTrack.X = MinimumSize.Width; limits.MinTrack.Y = MinimumSize.Height;
            Marshal.StructureToPtr(limits, message.LParam, false);
        }
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing && windowMenu != null) windowMenu.Dispose();
        base.Dispose(disposing);
    }
}
