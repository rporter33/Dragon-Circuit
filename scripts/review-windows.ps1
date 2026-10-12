# Windows 10/11 built-in PowerShell 5.1+. Read-only loopback static server.
# No URLACL/admin requirement: TcpListener binds directly to the loopback address.
param([int]$Port = 18787)
$ErrorActionPreference = 'Stop'
$reviewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'game'))
$rootPrefix = $reviewRoot + [IO.Path]::DirectorySeparatorChar
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.png'='image/png'; '.svg'='image/svg+xml'; '.woff'='font/woff'; '.woff2'='font/woff2'; '.jpg'='image/jpeg'; '.ico'='image/x-icon' }
try {
  $listener.Start()
  $reviewUrl = "http://127.0.0.1:$Port/"
  Write-Host "Private Lantern Dash review: $reviewUrl"
  Write-Host 'Keep this window open. Close it or press Ctrl+C to stop.'
  Start-Process $reviewUrl
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $request = $reader.ReadLine()
      if (!$request) { continue }
      $parts = $request.Split(' ')
      $headersRead = 0
      while ($reader.ReadLine() -ne '') { if (++$headersRead -gt 100) { throw 'Too many headers' } }
      $status = '200 OK'; $mime = 'text/plain'; $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
      if ($parts.Length -lt 3 -or $parts[0] -notin @('GET','HEAD')) { $status = '405 Method Not Allowed' }
      else {
        $route = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0]).TrimStart('/')
        if ($route -eq '') { $route = 'index.html' }
        $file = [IO.Path]::GetFullPath((Join-Path $reviewRoot $route.Replace('/', [IO.Path]::DirectorySeparatorChar)))
        if (!$file.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { $status = '404 Not Found' }
        else {
          $bytes = [IO.File]::ReadAllBytes($file)
          $extension = [IO.Path]::GetExtension($file).ToLowerInvariant()
          $mime = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
        }
      }
      $header = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n")
      $stream.Write($header, 0, $header.Length)
      if ($parts[0] -ne 'HEAD') { $stream.Write($bytes, 0, $bytes.Length) }
      $stream.Flush(); $reader.Dispose()
    } catch { Write-Host "Request ended: $($_.Exception.Message)" }
    finally { $client.Dispose() }
  }
} catch { Write-Host "Review launcher failed: $($_.Exception.Message). Another review may already use port $Port."; exit 1 }
finally { $listener.Stop() }
