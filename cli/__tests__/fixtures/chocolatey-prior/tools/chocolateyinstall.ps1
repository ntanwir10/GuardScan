$ErrorActionPreference = 'Stop'
$toolsDirectory = Split-Path -Parent $MyInvocation.MyCommand.Definition
$command = Join-Path $toolsDirectory 'guardscan.cmd'
Set-Content -Path $command -Value "@echo off`r`necho 1.0.5`r`n" -Encoding Ascii
Install-BinFile -Name 'guardscan' -Path $command
