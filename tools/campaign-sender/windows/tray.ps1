# The campaign sender's face on the Windows desktop: a tray icon that is there
# for as long as the sender runs, and a small card pinned above the taskbar when
# the sender needs the owner (a-campaign-goes-out-on-whatsapp, design D7).
#
# It decides nothing. Every two seconds it asks the sender's own page for its
# state (http://127.0.0.1:<port>/state) and draws what it is told:
#
#   the icon            what the sender is doing: its colour the kind of
#                       moment, its motion which one (see Colours below)
#   the card            whatever the state calls "attention", until it is put away
#
# A card stays on screen until Open or Later is pressed. Putting it away hides
# that one piece of news; the next one brings the card back by itself, and a
# click on the tray icon brings the current one back at any time.
#
# The sender starts this and it stops by itself about half a minute after the
# sender does. No icon means no sender.
#
# This file is plain ASCII on purpose. Windows PowerShell 5.1 reads a script
# without a byte-order mark as the system code page, and the repository refuses
# byte-order marks, so every word with a character outside ASCII comes from the
# sender's state, which arrives as UTF-8.
#
#   -Preview <file.png>   draw one card to a picture and exit (for looking at it)
#   -StopFile <path>      where "Stop the sender" writes the owner's stop request;
#                         the sender sees it and stops, and stays stopped

param(
  [int]$Port = 7418,
  [string]$StopFile = '',
  [string]$Preview = '',
  [string]$PreviewTone = 'action'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// A window that sits on top of everything and never takes the keyboard from
// whatever the owner is typing in.
public class SenderCard : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x08000000 | 0x00000080 | 0x00000008; // no-activate, tool window, topmost
      return cp;
    }
  }
}

public static class SenderNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
"@

[void][SenderNative]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

# The sender starts this hidden, so that no console window flashes. Windows
# then applies "hidden" to the first window the process ever shows, whatever
# that window asked for, and the first card would never appear. Found the hard
# way on 2026-11-18. So the first show is spent here, on a window nobody needs.
$spent = New-Object System.Windows.Forms.Form
[void][SenderNative]::ShowWindow($spent.Handle, 0)
$spent.Dispose()

$probe = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
$script:scale = $probe.DpiX / 96.0
$probe.Dispose()
function S([double]$n) { return [int][math]::Round($n * $script:scale) }
function Rgb([int]$r, [int]$g, [int]$b) { return [System.Drawing.Color]::FromArgb($r, $g, $b) }

$PageUrl = "http://127.0.0.1:$Port/"

# -- Colours ----------------------------------------------------------------

# The owner's rule (2026-11-22, recoloured 2026-11-23): a handful of
# colours, each a kind of moment, and two motions, each at one speed. Blue is
# all well, green is the owner's go (a batch waits for Send batch), yellow is
# reaching WhatsApp or mending itself, red needs the owner, grey is quiet and
# black is not running. Pulsing: something is being worked on, mending
# included. Blinking: it waits on the owner, which is a halt, or mending that
# has failed for ten minutes (the state's "stuck"). Anything else is still,
# starting up included. Standing down for another
# laptop's sender has no look of its own: it shows as ready, and the page says
# why it takes no batch.
$Blue   = (Rgb 37 99 235)
$Green  = (Rgb 34 197 94)
$Yellow = (Rgb 234 179 8)
$Red    = (Rgb 220 38 38)
$Grey   = (Rgb 140 140 150)
$Black  = (Rgb 24 24 27)
$MoodColours = @{
  idle                 = $Blue
  sending              = $Blue
  stood_down           = $Blue
  waiting_for_you      = $Green
  connecting           = $Yellow
  reconnecting         = $Yellow
  database_unreachable = $Yellow
  halted               = $Red
  held                 = $Grey
  outside_hours        = $Grey
  stopped              = $Black
  unreachable          = $Black
}
# Frames are shown one every 100 ms: a pulse takes 1.4 s, a blink 1.2 s.
$Pulse = @{ kind = 'pulse'; frames = 14 }
$Blink = @{ kind = 'blink'; frames = 12 }
$MoodMotion = @{
  sending              = $Pulse
  reconnecting         = $Pulse
  database_unreachable = $Pulse
  halted               = $Blink
}
$ToneColours = @{
  action = $Green
  done   = $Blue
  alarm  = $Red
}

# -- The tray icon ----------------------------------------------------------

function Mix([System.Drawing.Color]$a, [System.Drawing.Color]$b, [double]$t) {
  return [System.Drawing.Color]::FromArgb(
    [int]($a.R + ($b.R - $a.R) * $t), [int]($a.G + ($b.G - $a.G) * $t), [int]($a.B + ($b.B - $a.B) * $t))
}

# One frame of a state's icon. A pulse swells the light centre and lightens the
# dot, and settles back; a blink dims the dot for the second half.
function New-DotIcon([System.Drawing.Color]$colour, [string]$kind, [int]$frame, [int]$frames) {
  $bitmap = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $phase = if ($frames -gt 0) { $frame / $frames } else { 0 }
  $swell = (1 - [Math]::Cos(2 * [Math]::PI * $phase)) / 2
  $fillColour = $colour
  $centreSize = 8
  if ($kind -eq 'pulse') {
    $fillColour = Mix $colour ([System.Drawing.Color]::White) (0.35 * $swell)
    $centreSize = 7 + 7 * $swell
  }
  if ($kind -eq 'blink' -and $phase -ge 0.5) { $fillColour = Mix $colour ([System.Drawing.Color]::Black) 0.6 }
  $fill = New-Object System.Drawing.SolidBrush $fillColour
  $g.FillEllipse($fill, 3, 3, 26, 26)
  $ring = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 255, 255, 255)), 2.5
  $g.DrawEllipse($ring, 3, 3, 26, 26)
  # A small light centre, so it reads as a made thing and not a status light.
  $centre = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
  $offset = [single](16 - $centreSize / 2)
  $g.FillEllipse($centre, $offset, $offset, [single]$centreSize, [single]$centreSize)
  $fill.Dispose(); $ring.Dispose(); $centre.Dispose(); $g.Dispose()
  $handle = $bitmap.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle).Clone()
  [void][SenderNative]::DestroyIcon($handle)
  $bitmap.Dispose()
  return $icon
}

# -- The card ---------------------------------------------------------------

$script:card = $null
$script:cardTitle = $null
$script:cardLines = $null
$script:cardAccent = $null
$script:cardOpen = $null
$script:cardLater = $null
$script:shownId = ''
$script:dismissedId = ''
$script:attention = $null

function New-Card {
  $card = New-Object SenderCard
  $card.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $card.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $card.ShowInTaskbar = $false
  $card.TopMost = $true
  $card.BackColor = Rgb 31 26 23
  $card.Width = S 380

  $accent = New-Object System.Windows.Forms.Panel
  $accent.Dock = [System.Windows.Forms.DockStyle]::Left
  $accent.Width = S 6

  $brand = New-Object System.Windows.Forms.Label
  $brand.Text = 'SHAWARMANIA SENDER'
  $brand.Font = New-Object System.Drawing.Font 'Segoe UI', 8, ([System.Drawing.FontStyle]::Bold)
  $brand.ForeColor = Rgb 169 157 146
  $brand.AutoSize = $true
  $brand.Location = New-Object System.Drawing.Point (S 24), (S 16)

  $title = New-Object System.Windows.Forms.Label
  $title.Font = New-Object System.Drawing.Font 'Segoe UI', 13, ([System.Drawing.FontStyle]::Bold)
  $title.ForeColor = Rgb 250 245 238
  $title.AutoSize = $true
  $title.MaximumSize = New-Object System.Drawing.Size (S 332), 0
  $title.UseMnemonic = $false

  $lines = New-Object System.Windows.Forms.Label
  $lines.Font = New-Object System.Drawing.Font 'Segoe UI', 10
  $lines.ForeColor = Rgb 214 205 196
  $lines.AutoSize = $true
  $lines.MaximumSize = New-Object System.Drawing.Size (S 332), 0
  $lines.UseMnemonic = $false

  $open = New-Object System.Windows.Forms.Button
  $open.Text = 'Open'
  $open.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $open.FlatAppearance.BorderSize = 0
  $open.Font = New-Object System.Drawing.Font 'Segoe UI', 10, ([System.Drawing.FontStyle]::Bold)
  $open.BackColor = Rgb 234 122 60
  $open.ForeColor = Rgb 26 18 12
  $open.Size = New-Object System.Drawing.Size (S 104), (S 36)
  $open.Cursor = [System.Windows.Forms.Cursors]::Hand
  $open.TabStop = $false

  $later = New-Object System.Windows.Forms.Button
  $later.Text = 'Later'
  $later.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $later.FlatAppearance.BorderSize = 0
  $later.Font = New-Object System.Drawing.Font 'Segoe UI', 10
  $later.BackColor = Rgb 58 49 43
  $later.ForeColor = Rgb 235 228 220
  $later.Size = New-Object System.Drawing.Size (S 92), (S 36)
  $later.Cursor = [System.Windows.Forms.Cursors]::Hand
  $later.TabStop = $false

  $open.Add_Click({
      Start-Process $PageUrl
      Hide-Card $true
    })
  $later.Add_Click({ Hide-Card $true })

  $card.Controls.AddRange(@($brand, $title, $lines, $open, $later, $accent))

  $script:card = $card
  $script:cardTitle = $title
  $script:cardLines = $lines
  $script:cardAccent = $accent
  $script:cardOpen = $open
  $script:cardLater = $later
}

function Set-CardContent($attention) {
  $tone = [string]$attention.tone
  if (-not $ToneColours.ContainsKey($tone)) { $tone = 'action' }
  $script:cardAccent.BackColor = $ToneColours[$tone]
  $script:cardTitle.Text = [string]$attention.title
  $script:cardLines.Text = (@($attention.lines) -join "`r`n")
  if ($tone -eq 'done') { $script:cardLater.Text = 'Close' } else { $script:cardLater.Text = 'Later' }

  $left = S 24
  $script:cardTitle.Location = New-Object System.Drawing.Point $left, (S 40)
  $linesTop = $script:cardTitle.Bottom + (S 8)
  $script:cardLines.Location = New-Object System.Drawing.Point $left, $linesTop
  $buttonsTop = $script:cardLines.Bottom + (S 18)
  $script:cardOpen.Location = New-Object System.Drawing.Point $left, $buttonsTop
  $script:cardLater.Location = New-Object System.Drawing.Point ($left + $script:cardOpen.Width + (S 10)), $buttonsTop
  $script:card.Height = $buttonsTop + $script:cardOpen.Height + (S 20)
}

function Move-CardToCorner {
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $x = $area.Right - $script:card.Width - (S 16)
  $y = $area.Bottom - $script:card.Height - (S 16)
  $script:card.Location = New-Object System.Drawing.Point $x, $y
}

function Show-Card($attention) {
  if ($null -eq $script:card) { New-Card }
  Set-CardContent $attention
  Move-CardToCorner
  if (-not $script:card.Visible) {
    $script:card.Show()
    try {
      $round = 2
      [void][SenderNative]::DwmSetWindowAttribute($script:card.Handle, 33, [ref]$round, 4)
    } catch { }
  }
  $script:shownId = [string]$attention.id
}

# $putAway: the owner pressed a button, so this piece of news stays hidden.
function Hide-Card([bool]$putAway) {
  if ($putAway -and $script:shownId) { $script:dismissedId = $script:shownId }
  if ($null -ne $script:card -and $script:card.Visible) { $script:card.Hide() }
  $script:shownId = ''
}

# -- Looking at a card without a sender ------------------------------------

if ($Preview) {
  $sample = [pscustomobject]@{
    id    = 'preview'
    tone  = $PreviewTone
    title = 'Batch 3 is waiting for you'
    lines = @('"Diwali offer" - 100 people', 'Sent today: 200', 'Last batch finished at 14:05')
  }
  if ($PreviewTone -eq 'done') { $sample.title = 'Batch 3 is finished'; $sample.lines = @('Finished at 15:47') }
  if ($PreviewTone -eq 'alarm') {
    $sample.title = 'The sender has halted'
    $sample.lines = @('WhatsApp says this device was logged out. On the phone, open WhatsApp, then Linked devices.')
  }
  New-Card
  Set-CardContent $sample
  $script:card.Location = New-Object System.Drawing.Point -4000, -4000
  $script:card.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $picture = New-Object System.Drawing.Bitmap $script:card.Width, $script:card.Height
  $whole = New-Object System.Drawing.Rectangle 0, 0, $script:card.Width, $script:card.Height
  $script:card.DrawToBitmap($picture, $whole)
  $picture.Save($Preview, [System.Drawing.Imaging.ImageFormat]::Png)
  $script:card.Close()
  exit 0
}

# -- One helper per sender --------------------------------------------------

$created = $false
$mutex = New-Object System.Threading.Mutex($true, "ShawarmaniaCampaignSenderTray-$Port", [ref]$created)
if (-not $created) { exit 0 }

# -- Asking the sender ------------------------------------------------------

function Get-SenderState {
  $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/state")
  $request.Timeout = 1500
  $request.ReadWriteTimeout = 1500
  $request.Proxy = $null
  $response = $request.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
    return ($reader.ReadToEnd() | ConvertFrom-Json)
  } finally {
    $response.Close()
  }
}

# Each state's frames are drawn once and kept. A still state has one.
$script:icons = @{}
function Get-MoodFrames([string]$mood, [bool]$stuck) {
  if (-not $MoodColours.ContainsKey($mood)) { $mood = 'idle' }
  $key = if ($stuck) { "$mood stuck" } else { $mood }
  if (-not $script:icons.ContainsKey($key)) {
    $motion = if ($stuck) { $Blink } else { $MoodMotion[$mood] }
    $kind = if ($motion) { $motion.kind } else { 'still' }
    $count = if ($motion) { $motion.frames } else { 1 }
    $list = New-Object System.Collections.ArrayList
    for ($f = 0; $f -lt $count; $f++) { [void]$list.Add((New-DotIcon $MoodColours[$mood] $kind $f $count)) }
    $script:icons[$key] = $list
  }
  return ,$script:icons[$key]
}

# The state is read every two seconds; the icon moves on every 100 ms.
$script:mood = ''
$script:stuck = $false
$script:frame = 0
function Set-Mood([string]$mood, [bool]$stuck = $false) {
  if ($mood -eq $script:mood -and $stuck -eq $script:stuck) { return }
  $script:mood = $mood
  $script:stuck = $stuck
  $script:frame = 0
  $script:tray.Icon = (Get-MoodFrames $mood $stuck)[0]
}

function Set-TrayText([string]$text) {
  if ($text.Length -gt 63) { $text = $text.Substring(0, 62) + '.' }
  $script:tray.Text = $text
}

$script:tray = New-Object System.Windows.Forms.NotifyIcon
Set-Mood 'connecting'
$script:tray.Visible = $true

$script:animator = New-Object System.Windows.Forms.Timer
$script:animator.Interval = 100
$script:animator.Add_Tick({
    $frames = Get-MoodFrames $script:mood $script:stuck
    if ($frames.Count -lt 2) { return }
    $script:frame = ($script:frame + 1) % $frames.Count
    $script:tray.Icon = $frames[$script:frame]
  })
$script:animator.Start()
Set-TrayText 'Shawarmania sender: starting'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menuOpen = $menu.Items.Add('Open the sender page')
$menuCard = $menu.Items.Add('Show the card')
[void]$menu.Items.Add('-')
$menuHide = $menu.Items.Add('Hide this icon until the sender restarts')
if ($StopFile -ne '') {
  [void]$menu.Items.Add('-')
  $menuStop = $menu.Items.Add('Stop the sender...')
}
$script:tray.ContextMenuStrip = $menu

function Stop-Helper {
  $script:timer.Stop()
  $script:animator.Stop()
  Hide-Card $false
  $script:tray.Visible = $false
  $script:tray.Dispose()
  [System.Windows.Forms.Application]::ExitThread()
}

$menuOpen.Add_Click({ Start-Process $PageUrl })
$menuCard.Add_Click({
    if ($null -ne $script:attention) {
      $script:dismissedId = ''
      Show-Card $script:attention
    }
  })
$menuHide.Add_Click({ Stop-Helper })
if ($StopFile -ne '') {
  $menuStop.Add_Click({
      $answer = [System.Windows.Forms.MessageBox]::Show(
        "Stop sending campaigns from this laptop?`n`nIt stays stopped, even after a restart, until it is started again (npm run install-startup).",
        'Shawarmania sender',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question)
      if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
      # The sender looks for this file every two seconds and stops, after the
      # message in hand. Plain ASCII JSON, as keep-running.ts reads it.
      $at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      [System.IO.File]::WriteAllText($StopFile, "{""by"":""the tray icon"",""at"":""$at""}`n")
      Set-TrayText 'Shawarmania sender: stopping'
    })
}
$menu.Add_Opening({ $menuCard.Enabled = ($null -ne $script:attention) })

$script:tray.Add_MouseClick({
    param($sender, $click)
    if ($click.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    if ($null -ne $script:attention) {
      $script:dismissedId = ''
      Show-Card $script:attention
    } else {
      Start-Process $PageUrl
    }
  })

# -- The two-second round ---------------------------------------------------

$script:misses = 0
$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 2000
$script:timer.Add_Tick({
    $state = $null
    try { $state = Get-SenderState } catch { $state = $null }

    if ($null -eq $state) {
      $script:misses += 1
      $script:attention = $null
      Hide-Card $false
      Set-Mood 'unreachable'
      Set-TrayText 'Shawarmania sender: not running'
      # About half a minute of silence: the sender has gone, and so does this.
      if ($script:misses -ge 15) { Stop-Helper }
      return
    }

    $script:misses = 0
    Set-Mood ([string]$state.mood) ([bool]$state.stuck)
    Set-TrayText ('Shawarmania sender: ' + [string]$state.headline)

    $attention = $state.attention
    if ($null -eq $attention) {
      $script:attention = $null
      Hide-Card $false
      return
    }
    $script:attention = $attention
    if ([string]$attention.id -ne $script:dismissedId) { Show-Card $attention }
  })
$script:timer.Start()

[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex()
