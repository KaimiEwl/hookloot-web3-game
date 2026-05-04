param(
    [string]$HostAlias = 'demo-vm',
    [string]$RemoteAppDir = '/opt/portfolio-demo-app',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Resolve-SshExe {
    $gitSsh = 'C:\Program Files\Git\usr\bin\ssh.exe'
    if (Test-Path $gitSsh) { return $gitSsh }
    return 'ssh'
}

function Resolve-ScpExe {
    $gitScp = 'C:\Program Files\Git\usr\bin\scp.exe'
    if (Test-Path $gitScp) { return $gitScp }
    return 'scp'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$sshExe = Resolve-SshExe
$scpExe = Resolve-ScpExe
$tmpArchive = Join-Path $env:TEMP 'portfolio-demo-dist.tgz'

Write-Host "Deploy target: $HostAlias ($RemoteAppDir)"

if (-not $SkipBuild) {
    Write-Host 'Building local dist...'
    Push-Location $projectRoot
    try {
        npm run build | Out-Host
    } finally {
        Pop-Location
    }
}

if (Test-Path $tmpArchive) {
    Remove-Item -Force $tmpArchive
}

Write-Host 'Packing dist...'
tar -czf $tmpArchive -C $projectRoot dist

Write-Host 'Uploading dist archive...'
& $scpExe $tmpArchive "${HostAlias}:/tmp/portfolio-demo-dist.tgz"
if ($LASTEXITCODE -ne 0) {
    throw "SCP upload failed with exit code $LASTEXITCODE"
}

$remoteCmd = "set -e; APP_DIR='$RemoteAppDir'; mkdir -p `"`$APP_DIR`"; rm -rf `"`$APP_DIR/dist.new`"; mkdir -p `"`$APP_DIR/dist.new`"; tar -xzf /tmp/portfolio-demo-dist.tgz -C `"`$APP_DIR/dist.new`" --strip-components=1 dist; rm -rf `"`$APP_DIR/dist.prev`"; if [ -d `"`$APP_DIR/dist`" ]; then mv `"`$APP_DIR/dist`" `"`$APP_DIR/dist.prev`"; fi; mv `"`$APP_DIR/dist.new`" `"`$APP_DIR/dist`"; rm -f /tmp/portfolio-demo-dist.tgz; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/"

Write-Host 'Applying dist on server...'
$statusCode = & $sshExe $HostAlias $remoteCmd
if ($LASTEXITCODE -ne 0) {
    throw "SSH apply failed with exit code $LASTEXITCODE"
}
if ($statusCode -notmatch '^(200|301|302)$') {
    throw "Unexpected local service status after deploy: $statusCode"
}

Write-Host "Deploy complete. 127.0.0.1:3100 => $statusCode"

if (Test-Path $tmpArchive) {
    Remove-Item -Force $tmpArchive
}
