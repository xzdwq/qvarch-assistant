# Qvarch Assistant system probe.
# Emits one JSON line per interval: the foreground process and apps currently using the microphone.
# The window title is read only with -Titles 1 (enabled by the user in settings) — it can contain private text.
# With -Keys 1 it also emits {"k":[...],"m":N} lines: the moments of key presses (typing combo) and how far
# the mouse moved since the last line (activity graph). WHICH key was pressed is never read out, stored or
# emitted — only that some key went down; for the mouse only the distance, not where it is.
# Runs without admin rights and without native Node modules.
param([int]$IntervalMs = 2000, [int]$Titles = 0, [int]$Keys = 0)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class QaWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@

if ($Keys -eq 1) {
  # Raw Input (not a keyboard hook): a hidden window is told "a key went down" for every keyboard.
  # Auto-repeat of a held key is not counted. The scan code is used only for that check, in memory.
  Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class QaKeys : NativeWindow {
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort UsagePage; public ushort Usage; public uint Flags; public IntPtr Target; }
  [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public uint Type; public uint Size; public IntPtr Device; public IntPtr WParam; }
  [StructLayout(LayoutKind.Sequential)] struct RAWKEYBOARD { public ushort MakeCode; public ushort Flags; public ushort Reserved; public ushort VKey; public uint Message; public uint Extra; }
  [DllImport("user32.dll")] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
  [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr hRawInput, uint command, IntPtr data, ref uint size, uint headerSize);
  static readonly object Gate = new object();
  static readonly List<long> Pending = new List<long>();
  // a strong reference: an unreferenced NativeWindow gets collected and its window (and the subscription) dies
  static QaKeys Instance;
  // keys currently held — only to skip auto-repeat; never leaves this process
  readonly HashSet<int> down = new HashSet<int>();

  QaKeys() {
    CreateHandle(new CreateParams());
    var dev = new RAWINPUTDEVICE[1];
    dev[0].UsagePage = 1; dev[0].Usage = 6; dev[0].Flags = 0x100; dev[0].Target = Handle; // keyboard, RIDEV_INPUTSINK
    RegisterRawInputDevices(dev, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
  }

  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x00FF) { // WM_INPUT
      uint hs = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
      uint size = 0;
      GetRawInputData(m.LParam, 0x10000003, IntPtr.Zero, ref size, hs);
      if (size > 0) {
        IntPtr buf = Marshal.AllocHGlobal((int)size);
        try {
          if (GetRawInputData(m.LParam, 0x10000003, buf, ref size, hs) == size) {
            var head = (RAWINPUTHEADER)Marshal.PtrToStructure(buf, typeof(RAWINPUTHEADER));
            if (head.Type == 1) {
              var kb = (RAWKEYBOARD)Marshal.PtrToStructure(IntPtr.Add(buf, (int)hs), typeof(RAWKEYBOARD));
              int code = kb.MakeCode | ((kb.Flags & 2) != 0 ? 0x100 : 0);
              if ((kb.Flags & 1) != 0) down.Remove(code);
              else if (down.Add(code)) lock (Gate) Pending.Add(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            }
          }
        } finally { Marshal.FreeHGlobal(buf); }
      }
    }
    base.WndProc(ref m);
  }

  public static long[] Take() { lock (Gate) { var a = Pending.ToArray(); Pending.Clear(); return a; } }

  public static void Start() {
    var t = new System.Threading.Thread(() => { Instance = new QaKeys(); Application.Run(); });
    t.IsBackground = true;
    t.SetApartmentState(System.Threading.ApartmentState.STA);
    t.Start();
  }
}
"@
  [QaKeys]::Start()
}

$micRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'

function Get-MicUsers {
  $users = New-Object System.Collections.Generic.List[string]
  $keys = @()
  $keys += Get-ChildItem $micRoot | Where-Object { $_.PSChildName -ne 'NonPackaged' }
  $keys += Get-ChildItem (Join-Path $micRoot 'NonPackaged')
  foreach ($k in $keys) {
    $stop = $k.GetValue('LastUsedTimeStop')
    $start = $k.GetValue('LastUsedTimeStart')
    if ($null -ne $start -and $start -ne 0 -and $stop -eq 0) {
      $name = $k.PSChildName
      if ($name -like '*#*') { $name = ($name -split '#')[-1] }
      $users.Add($name)
    }
  }
  return ,$users.ToArray()
}

function Write-Sample {
  $h = [QaWin]::GetForegroundWindow()
  $procId = [uint32]0
  [void][QaWin]::GetWindowThreadProcessId($h, [ref]$procId)
  $proc = ''
  $path = ''
  if ($procId -ne 0) {
    $p = [System.Diagnostics.Process]::GetProcessById([int]$procId)
    if ($p) { $proc = $p.ProcessName; try { $path = $p.MainModule.FileName } catch {} }
  }
  $obj = [ordered]@{
    t     = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    pid   = $procId
    proc  = $proc
    path  = $path
    mic   = Get-MicUsers
  }
  if ($Titles -eq 1) { $obj.title = [QaWin]::Title($h) }
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3))
  [Console]::Out.Flush()
}

# Key moments and mouse distance go out every ~150 ms (live combo / activity); the full sample every IntervalMs.
$tick = 150
$next = 0
$prevPos = $null
while ($true) {
  $now = [Environment]::TickCount
  if ($now - $next -ge 0) {
    Write-Sample
    $next = $now + $IntervalMs
  }
  if ($Keys -eq 1) {
    $k = [QaKeys]::Take()
    $pos = [System.Windows.Forms.Cursor]::Position
    $m = 0
    if ($null -ne $prevPos) { $m = [int][Math]::Sqrt([Math]::Pow($pos.X - $prevPos.X, 2) + [Math]::Pow($pos.Y - $prevPos.Y, 2)) }
    $prevPos = $pos
    if ($k.Length -gt 0 -or $m -gt 0) {
      [Console]::Out.WriteLine('{"k":[' + ($k -join ',') + '],"m":' + $m + '}')
      [Console]::Out.Flush()
    }
    Start-Sleep -Milliseconds $tick
  } else {
    Start-Sleep -Milliseconds $IntervalMs
    $next = 0
  }
}
