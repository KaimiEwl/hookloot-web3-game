param(
    [string]$HostAlias = 'demo-vm',
    [int]$DebounceMs = 1400
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$deployScript = Join-Path $scriptDir 'deploy-demo-vm.ps1'

$ignorePattern = '(\\|/)(node_modules|dist|\.git|tmp|unzipped|\.cursor|\.agent)(\\|/)'
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $projectRoot
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [IO.NotifyFilters]'FileName, LastWrite, DirectoryName, Size'

$script:lastSignalAt = [DateTime]::MinValue
$script:pending = $false
$script:deployRunning = $false

function Should-IgnorePath([string]$fullPath) {
    if ([string]::IsNullOrWhiteSpace($fullPath)) { return $true }
    if ($fullPath -match $ignorePattern) { return $true }
    return $false
}

function Mark-Pending([string]$path) {
    if (Should-IgnorePath $path) { return }
    $script:lastSignalAt = Get-Date
    $script:pending = $true
    Write-Host "Change detected: $path"
}

$handlers = @()
$handlers += Register-ObjectEvent -InputObject $watcher -EventName Changed -Action { Mark-Pending $Event.SourceEventArgs.FullPath }
$handlers += Register-ObjectEvent -InputObject $watcher -EventName Created -Action { Mark-Pending $Event.SourceEventArgs.FullPath }
$handlers += Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action { Mark-Pending $Event.SourceEventArgs.FullPath }
$handlers += Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action { Mark-Pending $Event.SourceEventArgs.FullPath }

Write-Host "Watching $projectRoot"
Write-Host "Auto-deploy target: $HostAlias"
Write-Host "Press Ctrl+C to stop"

try {
    while ($true) {
        Start-Sleep -Milliseconds 500

        if (-not $script:pending) { continue }
        if ($script:deployRunning) { continue }

        $elapsed = (Get-Date) - $script:lastSignalAt
        if ($elapsed.TotalMilliseconds -lt $DebounceMs) { continue }

        $script:pending = $false
        $script:deployRunning = $true
        Write-Host "Starting deploy..."
        try {
            & powershell -ExecutionPolicy Bypass -File $deployScript -HostAlias $HostAlias | Out-Host
            Write-Host "Deploy OK"
        } catch {
            Write-Host "Deploy failed: $($_.Exception.Message)"
        } finally {
            $script:deployRunning = $false
        }
    }
} finally {
    foreach ($h in $handlers) {
        try { Unregister-Event -SubscriptionId $h.Id } catch { }
    }
    try { $watcher.Dispose() } catch { }
}
