# Qvarch Assistant tablet helper (XP-Pen Deco family, vendor HID interface).
# Switches the tablet into its vendor mode (the system pen goes quiet until the tablet is plugged in again),
# reads the pen (~200 reports/s) and drives the MOUSE: the chosen monitor / all monitors / the Qvarch window.
# The tip presses the left button past a pressure threshold; the side buttons are mapped.
# stdin: JSON lines {cmd:'config'|'reinit'|'monitors'}; stdout: JSON lines (status, monitors, samples).
# Opens no windows and needs no admin rights. Only the pen's position / pressure / tilt / buttons are read.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class QaTab {
  // ---------- Win32 ----------
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, string e, IntPtr h, int flags);
  [StructLayout(LayoutKind.Sequential)] struct DID { public int cb; public Guid g; public int f; public IntPtr r; }
  [DllImport("setupapi.dll")] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr i, ref Guid g, int n, ref DID d);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref DID d, IntPtr det, int size, out int req, IntPtr info);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);

  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  delegate bool MonitorEnumProc(IntPtr h, IntPtr dc, ref RECT r, IntPtr d);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc f, IntPtr d);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFOEX i);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);

  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public MOUSEINPUT mi; [FieldOffset(8)] public KEYBDINPUT ki; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

  // ---------- the tablet (Deco mini7: OpenTabletDriver's configuration) ----------
  const double MAX_X = 35560, MAX_Y = 22219, MAX_P = 8191, TAB_W = 177.8, TAB_H = 111.095;
  static readonly byte[] INIT = { 0x02, 0xB0, 0x04 };

  // ---------- settings (from Qvarch) ----------
  static readonly object gate = new object();
  static string kind = "monitor", monName = "", fallback = "";
  static IntPtr hwnd = IntPtr.Zero;
  static bool keepAspect = true, live = false;
  static int cvx, cvy, cvw, cvh;
  static int rot = 0;
  static double click = 0.04;
  static string b1 = "right", b2 = "middle";
  /** K1…K8: the virtual-key codes of each combination (press order). */
  static int[][] keyMap = new int[8][];
  static int keysDown;

  static List<RECT> monRects = new List<RECT>();
  static List<string> monNames = new List<string>();
  static int primaryIdx = 0;
  // the current target (physical pixels) — recomputed when settings / monitors / the window change
  static int tx0, ty0, tw = 1, th = 1;
  static double ax0, ay0, ax1 = 1, ay1 = 1;

  static string devicePath;

  // pen state
  static bool leftDown, rightDown, middleDown, inRange;
  static int lastB;
  static int lastX = int.MinValue, lastY = int.MinValue;
  static long lastEmit;

  public static void Start() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: physical pixels everywhere
    RefreshMonitors();
    new Thread(DeviceLoop) { IsBackground = true }.Start();
    new Thread(WindowLoop) { IsBackground = true }.Start();
  }

  /** "17,90;69;…" — 8 groups of comma-separated virtual-key codes. */
  public static void SetKeys(string spec) {
    var groups = (spec ?? "").Split(';');
    var map = new int[8][];
    for (int i = 0; i < 8; i++) {
      var list = new List<int>();
      if (i < groups.Length) foreach (var s in groups[i].Split(',')) { int v; if (int.TryParse(s, out v) && v > 0 && v < 256) list.Add(v); }
      map[i] = list.ToArray();
    }
    lock (gate) keyMap = map;
  }

  public static void Configure(string k, string name, long h, string fb, bool aspect, int r, double c, string bt1, string bt2, bool lv, int cx, int cy, int cw, int ch) {
    lock (gate) {
      kind = k ?? "monitor"; monName = name ?? ""; hwnd = new IntPtr(h); fallback = fb ?? "";
      cvx = cx; cvy = cy; cvw = cw; cvh = ch;
      keepAspect = aspect; rot = r; click = c; b1 = bt1 ?? "right"; b2 = bt2 ?? "middle"; live = lv;
      Recompute();
    }
  }
  public static void Reinit() { SendInit(); }

  // ---------- output ----------
  static readonly object outGate = new object();
  static void Emit(string json) { lock (outGate) { Console.Out.WriteLine(json); Console.Out.Flush(); } }
  static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }
  static void Status(string state, string extra) { Emit("{\"t\":\"status\",\"state\":\"" + state + "\"" + (extra ?? "") + "}"); }

  // ---------- monitors ----------
  public static void RefreshMonitors() {
    var rects = new List<RECT>(); var names = new List<string>(); int prim = 0;
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr dc, ref RECT r, IntPtr d) => {
      var mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(h, ref mi)) {
        if ((mi.dwFlags & 1) != 0) prim = rects.Count;
        rects.Add(mi.rcMonitor); names.Add(mi.szDevice);
      }
      return true;
    }, IntPtr.Zero);
    var sb = new StringBuilder("{\"t\":\"monitors\",\"list\":[");
    for (int i = 0; i < rects.Count; i++) {
      var r = rects[i];
      if (i > 0) sb.Append(',');
      sb.Append("{\"name\":\"" + Esc(names[i]) + "\",\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"primary\":" + (i == prim ? "true" : "false") + "}");
    }
    sb.Append("]}");
    lock (gate) { monRects = rects; monNames = names; primaryIdx = prim; Recompute(); }
    Emit(sb.ToString());
  }

  static bool MonitorRect(string name, out RECT r) {
    int i = monNames.IndexOf(name ?? "");
    if (i < 0) i = primaryIdx;
    if (i < 0 || i >= monRects.Count) { r = new RECT { L = 0, T = 0, R = GetSystemMetrics(0), B = GetSystemMetrics(1) }; return false; }
    r = monRects[i];
    return true;
  }

  static RECT winRect; static bool winOk;
  static void WindowLoop() {
    while (true) {
      RECT rc = new RECT(); bool ok = false;
      IntPtr h; lock (gate) h = hwnd;
      if (h != IntPtr.Zero && IsWindow(h) && IsWindowVisible(h) && !IsIconic(h)) {
        RECT c; POINT p = new POINT();
        if (GetClientRect(h, out c) && ClientToScreen(h, ref p) && c.R > 0 && c.B > 0) { rc = new RECT { L = p.X, T = p.Y, R = p.X + c.R, B = p.Y + c.B }; ok = true; }
      }
      lock (gate) {
        if (ok != winOk || rc.L != winRect.L || rc.T != winRect.T || rc.R != winRect.R || rc.B != winRect.B) { winOk = ok; winRect = rc; Recompute(); }
      }
      Thread.Sleep(150);
    }
  }

  /** Under the gate. */
  static void Recompute() {
    RECT r;
    if (kind == "all") {
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
      r = new RECT { L = vx, T = vy, R = vx + GetSystemMetrics(78), B = vy + GetSystemMetrics(79) };
    } else if (kind == "canvas" && winOk && cvw > 0 && cvh > 0) r = new RECT { L = winRect.L + cvx, T = winRect.T + cvy, R = winRect.L + cvx + cvw, B = winRect.T + cvy + cvh };
    else if ((kind == "window" || kind == "canvas") && winOk) r = winRect;
    else if (kind == "window" || kind == "canvas") MonitorRect(fallback, out r);
    else MonitorRect(monName, out r);
    tx0 = r.L; ty0 = r.T; tw = Math.Max(1, r.R - r.L); th = Math.Max(1, r.B - r.T);
    ax0 = 0; ay0 = 0; ax1 = 1; ay1 = 1;
    if (keepAspect) {
      double tab = (rot == 90 || rot == 270) ? TAB_H / TAB_W : TAB_W / TAB_H;
      double scr = (double)tw / th;
      if (tab > scr) { double f = scr / tab; ax0 = (1 - f) / 2; ax1 = (1 + f) / 2; }
      else { double f = tab / scr; ay0 = (1 - f) / 2; ay1 = (1 + f) / 2; }
    }
  }

  // ---------- the device ----------
  static string FindPath() {
    Guid g; HidD_GetHidGuid(out g);
    var s = SetupDiGetClassDevs(ref g, null, IntPtr.Zero, 0x12);
    string found = null;
    for (int i = 0; found == null; i++) {
      var d = new DID(); d.cb = Marshal.SizeOf(d);
      if (!SetupDiEnumDeviceInterfaces(s, IntPtr.Zero, ref g, i, ref d)) break;
      int req; SetupDiGetDeviceInterfaceDetail(s, ref d, IntPtr.Zero, 0, out req, IntPtr.Zero);
      var b = Marshal.AllocHGlobal(req); Marshal.WriteInt32(b, IntPtr.Size == 8 ? 8 : 6);
      if (SetupDiGetDeviceInterfaceDetail(s, ref d, b, req, out req, IntPtr.Zero)) {
        var p = Marshal.PtrToStringUni(IntPtr.Add(b, 4)).ToLowerInvariant();
        if (p.Contains("vid_28bd&pid_0928") && p.Contains("mi_02")) found = p;
      }
      Marshal.FreeHGlobal(b);
    }
    SetupDiDestroyDeviceInfoList(s);
    return found;
  }

  /** The vendor-mode command — through its own handle (a pending read must not block it). */
  static bool SendInit() {
    var p = devicePath;
    if (p == null) return false;
    using (var h = CreateFile(p, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
      if (h.IsInvalid) return false;
      try {
        using (var fs = new FileStream(h, FileAccess.ReadWrite, 32, false)) {
          var o = new byte[32]; Array.Copy(INIT, o, INIT.Length);
          fs.Write(o, 0, o.Length); fs.Flush();
        }
        return true;
      } catch { return false; }
    }
  }

  static void DeviceLoop() {
    bool searching = false;
    while (true) {
      var path = FindPath();
      if (path == null) {
        if (!searching) { Status("searching", null); searching = true; }
        Thread.Sleep(1500);
        continue;
      }
      searching = false;
      devicePath = path;
      var h = CreateFile(path, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (h.IsInvalid) { Status("error", ",\"message\":\"Нет доступа к планшету (" + Marshal.GetLastWin32Error() + ")\""); Thread.Sleep(3000); continue; }
      try {
        using (var fs = new FileStream(h, FileAccess.ReadWrite, 12, false)) {
          if (!SendInit()) { Status("error", ",\"message\":\"Планшет не принял команду режима\""); Thread.Sleep(3000); continue; }
          Status("connected", ",\"device\":\"XP-Pen Deco mini7 V2\"");
          var buf = new byte[12];
          while (true) {
            int n = fs.Read(buf, 0, 12);
            if (n <= 0) break;
            if (n >= 10) Process(buf);
          }
        }
      } catch { }
      ReleaseAll();
      devicePath = null;
      Status("searching", null);
      searching = true;
      Thread.Sleep(800);
    }
  }

  // ---------- a report → the mouse ----------
  static void Process(byte[] r) {
    byte st = r[1];
    if (st == 0xC0) { OutOfRange(); return; }
    if ((st & 0x10) != 0) { Aux(r); return; }
    if ((st & 0x80) == 0) return;
    int x = r[2] | r[3] << 8 | r[10] << 16, y = r[4] | r[5] << 8 | r[11] << 16, p = r[6] | r[7] << 8;
    int tilx = (sbyte)r[8], tily = (sbyte)r[9];
    double u = Math.Min(1, Math.Max(0, x / MAX_X)), v = Math.Min(1, Math.Max(0, y / MAX_Y)), pf = Math.Min(1, p / MAX_P);
    double ru, rv;
    int sx, sy; string b1m, b2m; double clk; bool lv;
    lock (gate) {
      if (rot == 90) { ru = 1 - v; rv = u; } else if (rot == 180) { ru = 1 - u; rv = 1 - v; } else if (rot == 270) { ru = v; rv = 1 - u; } else { ru = u; rv = v; }
      double cu = Math.Min(1, Math.Max(0, (ru - ax0) / (ax1 - ax0))), cv = Math.Min(1, Math.Max(0, (rv - ay0) / (ay1 - ay0)));
      sx = tx0 + (int)Math.Round(cu * (tw - 1)); sy = ty0 + (int)Math.Round(cv * (th - 1));
      b1m = b1; b2m = b2; clk = click; lv = live;
    }
    bool edge = !inRange;
    inRange = true;
    if (sx != lastX || sy != lastY) { MoveTo(sx, sy); lastX = sx; lastY = sy; }
    // the tip (or the eraser end): pressure past the threshold → left button; let go a bit below (no chatter)
    bool tipDown = leftDown ? pf >= clk * 0.6 : pf >= clk;
    if (tipDown != leftDown) { Button(tipDown ? 0x2u : 0x4u); leftDown = tipDown; edge = true; }
    int b = ((st & 0x02) != 0 ? 1 : 0) | ((st & 0x04) != 0 ? 2 : 0);
    if (b != lastB) {
      SideButton(b1m, (b & 1) != 0, (lastB & 1) != 0);
      SideButton(b2m, (b & 2) != 0, (lastB & 2) != 0);
      lastB = b; edge = true;
    }
    if (lv) {
      long now = Environment.TickCount;
      if (edge || now - lastEmit >= 16) {
        lastEmit = now;
        Emit(string.Format(System.Globalization.CultureInfo.InvariantCulture, "{{\"t\":\"s\",\"x\":{0:0.#####},\"y\":{1:0.#####},\"p\":{2:0.####},\"tx\":{3},\"ty\":{4},\"in\":true,\"c\":{5},\"b\":{6}}}", ru, rv, pf, tilx, tily, leftDown ? "true" : "false", b));
      }
    }
  }

  static void OutOfRange() {
    if (!inRange) return;
    ReleaseAll();
    inRange = false;
    bool lv; lock (gate) lv = live;
    if (lv) Emit("{\"t\":\"s\",\"x\":0,\"y\":0,\"p\":0,\"tx\":0,\"ty\":0,\"in\":false,\"c\":false,\"b\":0}");
  }

  // ---------- the express keys ----------
  static void Aux(byte[] r) {
    bool lv; lock (gate) lv = live;
    if (lv) Emit("{\"t\":\"aux\",\"raw\":\"" + BitConverter.ToString(r, 0, Math.Min(r.Length, 12)) + "\"}");
    // only the keys' own report (F0); others with this bit (B1 — the mode's answer) are not keys
    if ((r[1] & 0xF0) != 0xF0) return;
    int mask = r[2] | (r[3] << 8);
    if (lv) Emit("{\"t\":\"keys\",\"mask\":" + mask + "}");
    int[][] map; lock (gate) map = keyMap;
    for (int i = 0; i < 8; i++) {
      bool now = (mask & (1 << i)) != 0, was = (keysDown & (1 << i)) != 0;
      if (now == was || map[i] == null || map[i].Length == 0) continue;
      if (now) for (int j = 0; j < map[i].Length; j++) Key(map[i][j], false);
      else for (int j = map[i].Length - 1; j >= 0; j--) Key(map[i][j], true);
    }
    keysDown = mask;
  }
  static void ReleaseKeys() {
    int[][] map; lock (gate) map = keyMap;
    for (int i = 0; i < 8; i++) if ((keysDown & (1 << i)) != 0 && map[i] != null) for (int j = map[i].Length - 1; j >= 0; j--) Key(map[i][j], true);
    keysDown = 0;
  }
  static void Key(int vk, bool up) {
    var a = new INPUT[1];
    a[0].type = 1;
    a[0].ki.wVk = (ushort)vk;
    // the scan code too, like a real keyboard: apps that look at the physical key (a browser's event.code —
    // "KeyZ") get nothing without it
    a[0].ki.wScan = (ushort)MapVirtualKey((uint)vk, 0);
    // arrows, Home/End, PgUp/PgDn, Insert/Delete, Win — extended keys
    bool ext = (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B;
    a[0].ki.dwFlags = (up ? 0x2u : 0u) | (ext ? 0x1u : 0u);
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void ReleaseAll() {
    ReleaseKeys();
    if (leftDown) { Button(0x4); leftDown = false; }
    if (rightDown) { Button(0x10); rightDown = false; }
    if (middleDown) { Button(0x40); middleDown = false; }
    lastB = 0;
  }

  static void SideButton(string map, bool now, bool was) {
    if (now == was) return;
    if (map == "right") { Button(now ? 0x8u : 0x10u); rightDown = now; }
    else if (map == "middle") { Button(now ? 0x20u : 0x40u); middleDown = now; }
  }

  static void MoveTo(int x, int y) {
    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
    var a = new INPUT[1];
    a[0].type = 0;
    a[0].mi.dx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1));
    a[0].mi.dy = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
    a[0].mi.dwFlags = 0x0001 | 0x8000 | 0x4000; // MOVE | ABSOLUTE | VIRTUALDESK
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }

  static void Button(uint flag) {
    var a = new INPUT[1];
    a[0].type = 0;
    a[0].mi.dwFlags = flag;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

[QaTab]::Start()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $m = $line | ConvertFrom-Json
    switch ($m.cmd) {
      'config' {
        $cv = @($m.canvas) + @(0, 0, 0, 0)
        [QaTab]::SetKeys([string]$m.keys)
        [QaTab]::Configure([string]$m.kind, [string]$m.name, [long]$m.hwnd, [string]$m.fallback, [bool]$m.keepAspect, [int]$m.rotation, [double]$m.click, [string]$m.button1, [string]$m.button2, [bool]$m.live, [int]$cv[0], [int]$cv[1], [int]$cv[2], [int]$cv[3])
      }
      'reinit' { [QaTab]::Reinit() }
      'monitors' { [QaTab]::RefreshMonitors() }
    }
  } catch { }
}
[QaTab]::ReleaseAll()
