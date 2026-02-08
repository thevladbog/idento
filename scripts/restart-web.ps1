# Restart Idento Web Frontend on Windows
# PowerShell script for targeted restart

. "$PSScriptRoot\common\colors.ps1"

Write-Info "Restarting Idento Web Frontend..."

$ProjectRoot = Get-ProjectRoot
$LogsDir = Join-Path $ProjectRoot "..\logs"
$PidsFile = Join-Path $LogsDir "pids.txt"

if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

function Get-Pids {
    if (Test-Path $PidsFile) {
        return Get-Content $PidsFile
    }
    return @()
}

function Save-Pids {
    param([string[]]$Pids)
    $Pids | Out-File -FilePath $PidsFile -Encoding ASCII
}

function Stop-ProcessByPort {
    param([int]$Port)
    $pattern = ":{0}\s+" -f $Port
    $netstatLines = netstat -ano | Select-String -Pattern $pattern | Where-Object { $_.Line -match "LISTENING" }
    foreach ($line in $netstatLines) {
        $parts = $line.Line -split "\s+"
        if ($parts.Length -ge 5) {
            $procId = $parts[-1]
            if ($procId -match '^\d+$' -and $procId -ne '0') {
                try {
                    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                    if ($proc) {
                        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                        Write-Success "Stopped process $procId ($($proc.ProcessName)) on port $Port"
                    }
                }
                catch {
                    Write-Warning "Failed to stop PID $procId on port $Port"
                }
            }
        }
    }
}

function Stop-ProcessTree {
    param([int]$Pid)
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$Pid" -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        Stop-ProcessTree -Pid $child.ProcessId
    }
    try {
        $proc = Get-Process -Id $Pid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue
            Write-Success "Stopped process $Pid ($($proc.ProcessName))"
        }
    }
    catch {
        Write-Warning "Failed to stop PID $Pid"
    }
}

$existing = Get-Pids
while ($existing.Count -lt 3) { $existing += "" }

$webPid = $existing[1]
if ($webPid -match '^\d+$') {
    try {
        Stop-ProcessTree -Pid $webPid
    }
    catch {
        Write-Warning "Web PID $webPid not found"
    }
} else {
    Write-Warning "Web PID not found in logs\pids.txt"
}

Stop-ProcessByPort -Port 5173

$WebPath = Join-Path $ProjectRoot "..\web"
$WebLog = Join-Path $LogsDir "web.log"
$WebErrLog = Join-Path $LogsDir "web.error.log"

$WebNodeModules = Join-Path $WebPath "node_modules"
if (-not (Test-Path $WebNodeModules)) {
    Write-Warning "Web dependencies not found. Installing..."
    Push-Location $WebPath
    npm ci
    $installExitCode = $LASTEXITCODE
    Pop-Location
    if ($installExitCode -ne 0) {
        Write-Error "Failed to install web dependencies"
        exit 1
    }
}

$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"
$WebJob = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $WebPath -WindowStyle Hidden -RedirectStandardOutput $WebLog -RedirectStandardError $WebErrLog -PassThru

Start-Sleep -Seconds 2
$WebProcess = Get-Process -Id $WebJob.Id -ErrorAction SilentlyContinue
if (-not $WebProcess) {
    Write-Error "Web frontend failed to start. Check logs\web.error.log"
    exit 1
}

$existing[1] = [string]$WebJob.Id
Save-Pids -Pids $existing

Write-Success "Web restarted successfully (PID: $($WebJob.Id))"
