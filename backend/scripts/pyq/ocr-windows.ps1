# OCR page images with the built-in Windows OCR engine (no install, no network).
# Usage: powershell -NoProfile -File ocr-windows.ps1 -OutFile pages.jsonl [-Language en-US] <image.png> [...]
# Writes one JSON object per line: { image, width, height, lines: [{ text, words: [{ text, x, y, w, h }] }] }
# Output goes to a UTF-8 file rather than stdout because the console host wraps long lines.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$Language = 'en-US',
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Images
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait() | Out-Null
    return $task.Result
}
function Clean([string]$value) { return ($value -replace '\p{Cc}', '') }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
if ($null -eq $engine) { throw "Windows OCR language '$Language' is not installed." }

$writer = New-Object System.IO.StreamWriter($OutFile, $false, (New-Object System.Text.UTF8Encoding($false)))
try {
    foreach ($image in $Images) {
        $path = (Resolve-Path $image).Path
        $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
        $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        try {
            $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
            $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
            $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $lines = foreach ($line in $result.Lines) {
                [pscustomobject]@{
                    text  = Clean $line.Text
                    words = @(foreach ($word in $line.Words) {
                        $r = $word.BoundingRect
                        [pscustomobject]@{ text = (Clean $word.Text); x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
                    })
                }
            }
            $writer.WriteLine(([pscustomobject]@{ image = $path; width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lines = @($lines) } | ConvertTo-Json -Depth 6 -Compress))
        } finally { $stream.Dispose() }
    }
} finally { $writer.Dispose() }
