# Install this build's PDFluffer installer through its windows, as a user would.
#
# Adapted from Tabiya's scripts/upgrade-walk.ps1 (2026-10-28), which exists because
# two Tabiya releases shipped an upgrade that failed. Two reasons it is done this way:
#
# 1. A silent /S install skips the "Already Installed" page, and that page is where
#    the old uninstaller is run. So this script clicks through the real pages, picks
#    the uninstall option, and records the command line the installer gives the old
#    uninstaller. An empty `_?=` means the old install's folder was not found, which
#    is what a changed publisher causes.
#
# 2. A Claude Code session's shell runs in a sandbox whose writes to the user's
#    registry and LocalAppData land in a private copy. Installs run from it leave the
#    REAL machine untouched. So it has to be started by Explorer, which runs it as
#    the user:
#
#        Start-Process explorer.exe '"<repo>\scripts\upgrade-walk.cmd"'
#
#    The session then waits for the log's `.finished` marker and reads the log.
#
# It drives the windows with WM_COMMAND and BM_CLICK, never the mouse, and it stops
# rather than going on if the uninstaller's "Delete the application data" box is
# ticked. It leaves the new version installed and closed.

param([string]$SetupPath, [string]$Log = "$env:TEMP\pdfluffer-upgrade-walk.log")

$repo = Split-Path -Parent $PSScriptRoot
if (-not $SetupPath) {
  $version = (Get-Content "$repo\package.json" -Raw | ConvertFrom-Json).version
  $SetupPath = "$repo\src-tauri\target\release\bundle\nsis\PDFluffer_${version}_x64-setup.exe"
}

function Finish($how) { Set-Content -LiteralPath "$Log.finished" -Value $how; exit }
function L($m) {
  for ($k = 0; $k -lt 20; $k++) {
    try { Add-Content -LiteralPath $Log -Value ("{0:HH:mm:ss} {1}" -f (Get-Date), $m) -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 100 }
  }
}
trap { L "UNHANDLED: $_"; Finish 'failed' }

Remove-Item -LiteralPath "$Log.finished" -ErrorAction SilentlyContinue
Set-Content -LiteralPath $Log -Value "=== upgrade walk: $SetupPath"

Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class W { public delegate bool E(IntPtr h, IntPtr l);
[DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, E e, IntPtr l);
[DllImport("user32.dll")] static extern bool EnumWindows(E e, IntPtr l);
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr h, int m, IntPtr w, IntPtr l);
static string T(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
public static List<IntPtr> Tops(uint pid) { var r = new List<IntPtr>(); EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) r.Add(h); return true; }, IntPtr.Zero); return r; }
public static string Texts(uint pid) { var o = new StringBuilder(); foreach (var h in Tops(pid)) { o.Append("{" + T(h) + ":"); EnumChildWindows(h, (k, m) => { if (!IsWindowVisible(k)) return true; var x = T(k).Replace("\r\n", " "); if (x.Length > 0 && x.Length < 90 && !x.StartsWith("Copyright") && !x.StartsWith("Nullsoft")) o.Append(" [" + x + "]"); return true; }, IntPtr.Zero); o.Append("} "); } return o.ToString(); }
public static IntPtr Child(uint pid, string text) { IntPtr r = IntPtr.Zero; foreach (var h in Tops(pid)) { EnumChildWindows(h, (k, m) => { if (IsWindowVisible(k) && T(k).Replace("&", "").StartsWith(text)) { r = k; return false; } return true; }, IntPtr.Zero); if (r != IntPtr.Zero) break; } return r; }
public static IntPtr Top(uint pid) { foreach (var h in Tops(pid)) { if (T(h).StartsWith("PDFluffer")) return h; } return IntPtr.Zero; } }
"@

$WM_COMMAND = 0x111; $BM_CLICK = 0xF5; $BM_GETCHECK = 0xF0
function Next($procId) { [void][W]::PostMessage([W]::Top($procId), $WM_COMMAND, [IntPtr]1, [IntPtr]::Zero) }
function Checked($h) { [int][W]::SendMessage($h, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero) }

function State($label) {
  L "--- state: $label"
  $u = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PDFluffer' -ErrorAction SilentlyContinue
  L ("uninstall entry: version '{0}', publisher '{1}'" -f $u.DisplayVersion, $u.Publisher)
  # The key an upgrade reads the install folder from is named after the publisher.
  # 0.1.0 had no publisher set, so Tauri used "pdfluffer", the identifier's second part.
  L ("install-folder key HKCU\Software\Nicholas Walker\PDFluffer: '{0}'" -f (Get-ItemProperty 'HKCU:\Software\Nicholas Walker\PDFluffer' -ErrorAction SilentlyContinue).'(default)')
  L ("old key HKCU\Software\pdfluffer\PDFluffer exists: {0}" -f (Test-Path 'HKCU:\Software\pdfluffer\PDFluffer'))
  foreach ($f in "$env:LOCALAPPDATA\PDFluffer\pdfluffer.exe", "$env:LOCALAPPDATA\PDFluffer\uninstall.exe") {
    if (Test-Path $f) {
      $s = Get-AuthenticodeSignature $f
      L ("{0}: version {1}, signature {2}, signer '{3}'" -f (Split-Path $f -Leaf), (Get-Item $f).VersionInfo.ProductVersion, $s.Status, $s.SignerCertificate.Subject)
    } else { L "$(Split-Path $f -Leaf): MISSING" }
  }
  $state = "$env:APPDATA\com.pdfluffer.desktop\state.json"
  if (Test-Path $state) { $i = Get-Item $state; L ("state.json: {0} bytes, saved {1}" -f $i.Length, $i.LastWriteTime) } else { L "state.json: MISSING" }
}

function WaitFor($procId, $pattern, $seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    Start-Sleep -Milliseconds 500
    $t = [W]::Texts($procId)
    if ($t -match $pattern) { return $t }
    if ($t -match 'Unable to uninstall|Error launching') { L "ERROR WINDOW: $t"; return $t }
  }
  L "TIMEOUT waiting for /$pattern/; last: $([W]::Texts($procId))"
  return $null
}

if (-not (Test-Path $SetupPath)) { L "no installer at $SetupPath"; Finish 'stopped' }
State 'before'
if (Get-Process pdfluffer -ErrorAction SilentlyContinue) { L 'PDFluffer is running; close it first'; Finish 'stopped' }

$setup = Start-Process $SetupPath -PassThru
# SmartScreen checks a new signed file before its window opens, which can take most of a minute.
$t = WaitFor $setup.Id 'Welcome to PDFluffer Setup' 90; L "page: $t"
Next $setup.Id
$t = WaitFor $setup.Id 'Already Installed|Choose Install Location' 20; L "page: $t"

if ($t -match 'Already Installed') {
  $first = if ($t -match 'Uninstall before installing') { 'Uninstall before installing' } else { 'Uninstall PDFluffer' }
  $radio = [W]::Child($setup.Id, $first)
  if ($first -eq 'Uninstall PDFluffer') { [void][W]::SendMessage($radio, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) }
  L ("'{0}' chosen: {1}" -f $first, (Checked $radio))
  Next $setup.Id

  $un = $null
  for ($i = 0; $i -lt 30 -and -not $un; $i++) {
    Start-Sleep -Milliseconds 500
    $un = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($setup.Id)" | Where-Object Name -match 'uninstall|^Un' | Select-Object -First 1
  }
  if (-not $un) { L 'no uninstaller started'; L "setup: $([W]::Texts($setup.Id))"; Finish 'failed' }
  L "uninstaller command line: $($un.CommandLine)"
  if ($un.CommandLine -match '_\?=\s*$') { L 'FAULT: the old uninstaller was given no install folder' }
  $t = WaitFor $un.ProcessId 'Remove PDFluffer|NSIS Error' 20; L "uninstaller page: $t"
  if ($t -match 'Error launching') { Finish 'failed' }

  $box = [W]::Child($un.ProcessId, 'Delete the application data')
  L ("'Delete the application data' ticked: {0}" -f (Checked $box))
  if ((Checked $box) -ne 0) { L 'the data box is ticked; stopping without uninstalling'; Finish 'stopped' }
  Next $un.ProcessId
  $t = WaitFor $un.ProcessId 'Uninstallation Complete' 30; L "uninstaller page: $t"
  Next $un.ProcessId
  $t = WaitFor $setup.Id 'Choose Install Location' 20; L "page: $t"
  if ($t -notmatch 'Choose Install Location') { Finish 'failed' }
}

Next $setup.Id
$t = WaitFor $setup.Id 'Installation Complete|Completing' 60; L "page: $t"
if ($t -match 'Installation Complete') { Next $setup.Id; $t = WaitFor $setup.Id 'Completing' 20; L "page: $t" }
$run = [W]::Child($setup.Id, 'Run PDFluffer')
if ($run -ne [IntPtr]::Zero -and (Checked $run) -eq 1) { [void][W]::SendMessage($run, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero); L ("'Run PDFluffer' unticked: {0}" -f ((Checked $run) -eq 0)) }
Next $setup.Id
$setup.WaitForExit(20000) | Out-Null
L "setup exited: $($setup.HasExited), exit code $($setup.ExitCode)"
Start-Sleep 2
foreach ($p in Get-Process pdfluffer -ErrorAction SilentlyContinue) { L 'closing a PDFluffer the installer started'; [void]$p.CloseMainWindow(); Start-Sleep 3 }

State 'after'
$app = Start-Process "$env:LOCALAPPDATA\PDFluffer\pdfluffer.exe" -PassThru
Start-Sleep 6; $app.Refresh()
L "app window: '$($app.MainWindowTitle)'"
[void]$app.CloseMainWindow(); Start-Sleep 3; $app.Refresh()
L "app closed: $($app.HasExited)"
L '=== done'
Finish 'done'
