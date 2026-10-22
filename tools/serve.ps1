# Minimal static file server for local testing (PowerShell + HttpListener)
param(
  [string]$Root = "C:\Users\ACER\Documents\Projet par défaut",
  [int]$Port = 8899
)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $Root on http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".png"  = "image/png"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".woff2"= "font/woff2"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $url = $req.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($url)) { $url = "index.html" }
    $decoded = [System.Uri]::UnescapeDataString($url)
    $full = Join-Path $Root $decoded
    if (Test-Path -LiteralPath $full -PathType Container) { $full = Join-Path $full "index.html" }

    if (Test-Path -LiteralPath $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentType = $type
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $b = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $res.ContentType = "text/plain; charset=utf-8"
      $res.ContentLength64 = $b.Length
      $res.OutputStream.Write($b, 0, $b.Length)
    }
    $res.OutputStream.Close()
  } catch {
    Write-Output "error: $($_.Exception.Message)"
    try { $listener.Stop() } catch {}
  }
}
