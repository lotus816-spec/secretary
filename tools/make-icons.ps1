# Generates PNG icons for the Secretary PWA using System.Drawing.
param(
  [string]$OutDir = ""
)
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = Join-Path (Split-Path -Parent $PSScriptRoot) "icons"
}
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

function New-Icon {
  param([int]$Size, [string]$Path, [bool]$Maskable = $false)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = 0
  if (-not $Maskable) { $pad = [int]([Math]::Round($Size * 0.055)) }
  $w   = $Size - (2 * $pad)
  $r   = 0
  if (-not $Maskable) { $r = [int]([Math]::Round($Size * 0.225)) }
  $d   = 2 * $r

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($Size, $Size)),
    [System.Drawing.Color]::FromArgb(255, 47, 95, 240),
    [System.Drawing.Color]::FromArgb(255, 13, 148, 136))
  $g.FillRectangle($brush, $pad, $pad, $w, $w)

  if ($d -gt 0) {
    # punch rounded corners by overdrawing transparent is not possible on a filled
    # shape, so instead build the rounded body from ellipses + a center band.
    $bmp2 = $bmp
  }
  $g.Dispose()

  # --- redraw with rounded shape (maskable = full bleed square) ---
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($Size, $Size)),
    [System.Drawing.Color]::FromArgb(255, 47, 95, 240),
    [System.Drawing.Color]::FromArgb(255, 13, 148, 136))

  if ($d -gt 0) {
    $g.FillEllipse($brush, $pad, $pad, $d, $d)
    $g.FillEllipse($brush, ($pad + $w - $d), $pad, $d, $d)
    $g.FillEllipse($brush, $pad, ($pad + $w - $d), $d, $d)
    $g.FillEllipse($brush, ($pad + $w - $d), ($pad + $w - $d), $d, $d)
    $g.FillRectangle($brush, ($pad + $r), $pad, ($w - 2 * $r), $w)
    $g.FillRectangle($brush, $pad, ($pad + $r), $w, ($w - 2 * $r))
  } else {
    $g.FillRectangle($brush, 0, 0, $Size, $Size)
  }

  # --- white check mark ---
  $inset = 0.26
  if ($Maskable) { $inset = 0.30 }
  $x1 = $Size * $inset
  $y1 = $Size * 0.52
  $x2 = $Size * 0.44
  $y2 = $Size * 0.71
  $x3 = $Size * (1 - $inset)
  $y3 = $Size * 0.32

  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, ([float]($Size * 0.10)))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts = New-Object 'System.Drawing.PointF[]' 3
  $pts[0] = New-Object System.Drawing.PointF([float]$x1, [float]$y1)
  $pts[1] = New-Object System.Drawing.PointF([float]$x2, [float]$y2)
  $pts[2] = New-Object System.Drawing.PointF([float]$x3, [float]$y3)
  $g.DrawLines($pen, $pts)

  # --- accent dot (top-left) ---
  $cx = [float]($Size * 0.285)
  $cy = [float]($Size * 0.285)
  $rad = [float]($Size * 0.072)
  $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
  $g.FillEllipse($fill, ($cx - $rad), ($cy - $rad), ($rad * 2), ($rad * 2))

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose(); $fill.Dispose()
  Write-Output "  -> $Path"
}

Write-Output "Generating Secretary icons into $OutDir"
New-Icon -Size 192 -Path (Join-Path $OutDir "icon-192.png")
New-Icon -Size 512 -Path (Join-Path $OutDir "icon-512.png")
New-Icon -Size 512 -Path (Join-Path $OutDir "maskable-512.png") -Maskable $true
New-Icon -Size 180 -Path (Join-Path $OutDir "apple-touch-icon.png")
Write-Output "Done."
