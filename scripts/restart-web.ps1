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

$existing = Get-Pids
while ($existing.Count -lt 3) { $existing += "" }

$webPid = $existing[1]
if ($webPid -match '^\d+$') {
    try {
        $proc = Get-Process -Id $webPid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $webPid -Force
            Write-Success "Stopped web process $webPid ($($proc.ProcessName))"
        }
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
    Set-Location $WebPath
    npm ci
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install web dependencies"
        exit 1
    }
}

$WebJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "chcp 65001 > nul & set NO_COLOR=1 & set FORCE_COLOR=0 & npm run dev" -WorkingDirectory $WebPath -WindowStyle Hidden -RedirectStandardOutput $WebLog -RedirectStandardError $WebErrLog -PassThru

Start-Sleep -Seconds 2
$WebProcess = Get-Process -Id $WebJob.Id -ErrorAction SilentlyContinue
if (-not $WebProcess) {
    Write-Error "Web frontend failed to start. Check logs\web.error.log"
    exit 1
}

$existing[1] = [string]$WebJob.Id
Save-Pids -Pids $existing

Write-Success "Web restarted successfully (PID: $($WebJob.Id))"
