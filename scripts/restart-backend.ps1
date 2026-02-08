# Restart Idento Backend on Windows
# PowerShell script for targeted restart

. "$PSScriptRoot\common\colors.ps1"

Write-Info "Restarting Idento Backend..."

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

$backendPid = $existing[0]
if ($backendPid -match '^\d+$') {
    try {
        $proc = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $backendPid -Force
            Write-Success "Stopped backend process $backendPid ($($proc.ProcessName))"
        }
    }
    catch {
        Write-Warning "Backend PID $backendPid not found"
    }
} else {
    Write-Warning "Backend PID not found in logs\pids.txt"
}

Stop-ProcessByPort -Port 8008

$BackendPath = Join-Path $ProjectRoot "..\backend"
$BackendLog = Join-Path $LogsDir "backend.log"
$BackendErrLog = Join-Path $LogsDir "backend.error.log"
$BackendBinary = Join-Path $BackendPath "backend.exe"

Write-Info "Building backend binary..."
Push-Location $BackendPath
& go build -o $BackendBinary
$buildExitCode = $LASTEXITCODE
Pop-Location
if ($buildExitCode -ne 0) {
    Write-Error "Backend build failed. Check output above."
    exit 1
}

$BackendJob = Start-Process -FilePath $BackendBinary -WorkingDirectory $BackendPath -WindowStyle Hidden -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendErrLog -PassThru

Start-Sleep -Seconds 2
$BackendProcess = Get-Process -Id $BackendJob.Id -ErrorAction SilentlyContinue
if (-not $BackendProcess) {
    Write-Error "Backend failed to start. Check logs\backend.error.log"
    exit 1
}

$existing[0] = [string]$BackendJob.Id
Save-Pids -Pids $existing

Write-Success "Backend restarted successfully (PID: $($BackendJob.Id))"
