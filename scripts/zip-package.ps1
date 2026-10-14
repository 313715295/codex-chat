param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$taskSourcePath = (Resolve-Path -LiteralPath $Source).Path
$taskDestinationPath = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $taskDestinationPath) { throw 'Package archive already exists' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($taskSourcePath,$taskDestinationPath,[System.IO.Compression.CompressionLevel]::Optimal,$false)
