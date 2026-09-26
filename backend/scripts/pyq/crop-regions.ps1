# Crop regions out of page images and scale them up, for a second OCR pass on sparse text
# (short side-by-side options such as "(a) 20%   (b) 25%" that full-page OCR tends to skip).
#
# Usage: powershell -NoProfile -File crop-regions.ps1 -Regions regions.json -Scale 2.5
# regions.json: [{ "id": "q16", "image": "C:\\...\\page-11.jpg", "x": 0, "y": 0, "w": 0, "h": 0, "out": "C:\\...\\q16.png" }, ...]
# Writes each crop (white-padded) to its "out" path.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string]$Regions,
    [double]$Scale = 2.5
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# Assign before wrapping: PowerShell 5 emits a parsed JSON array as one pipeline object.
$parsed = ConvertFrom-Json (Get-Content -Raw (Resolve-Path $Regions).Path)
$items = @($parsed)
$cache = @{}
$pad = 30
foreach ($item in $items) {
    if (-not $cache.ContainsKey($item.image)) { $cache[$item.image] = [System.Drawing.Bitmap]::FromFile((Resolve-Path $item.image).Path) }
    $source = $cache[$item.image]
    $x = [Math]::Max(0, [int]$item.x); $y = [Math]::Max(0, [int]$item.y)
    $w = [Math]::Min($source.Width - $x, [int]$item.w); $h = [Math]::Min($source.Height - $y, [int]$item.h)
    if ($w -le 0 -or $h -le 0) { continue }
    $canvas = New-Object System.Drawing.Bitmap ([int]($w * $Scale + $pad * 2)), ([int]($h * $Scale + $pad * 2))
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $src = New-Object System.Drawing.Rectangle $x, $y, $w, $h
    $dst = New-Object System.Drawing.Rectangle $pad, $pad, ([int]($w * $Scale)), ([int]($h * $Scale))
    $graphics.DrawImage($source, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    $canvas.Save($item.out, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
}
foreach ($bitmap in $cache.Values) { $bitmap.Dispose() }
