$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $projectRoot "tools\ComicLauncher.cs"
$output = Join-Path $projectRoot "ComicLauncher.exe"
$icon = Join-Path $projectRoot "assets\favicon.ico"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path $compiler)) {
    $compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $compiler)) {
    throw "Windows C# compiler csc.exe was not found."
}

$arguments = @(
    "/nologo"
    "/target:winexe"
    "/optimize+"
    "/reference:System.dll"
    "/reference:System.Windows.Forms.dll"
    "/out:$output"
)
if (Test-Path $icon) {
    $arguments += "/win32icon:$icon"
}
$arguments += $source

& $compiler $arguments
if ($LASTEXITCODE -ne 0) {
    throw "Launcher compilation failed with exit code $LASTEXITCODE."
}

Write-Host "Created: $output"
