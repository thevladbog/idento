# Stop all Idento services on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

Write-Info "Stopping Idento system on Windows..."

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogsDir = Join-Path $ProjectRoot "logs"
$PidsFile = Join-Path $LogsDir "pids.txt"

# Stop processes from PID file
if (Test-Path $PidsFile) {
    Write-Info "Stopping processes..."
    $ProcessIds = Get-Content $PidsFile
    
    foreach ($ProcessId in $ProcessIds) {
        if ($ProcessId -match '^\d+$') {
            try {
                $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
                if ($Process) {
                    Stop-Process -Id $ProcessId -Force
                    Write-Success "Stopped process $ProcessId ($($Process.ProcessName))"
                }
            }
            catch {
                Write-Warning "Process $ProcessId not found (might have already stopped)"
            }
        }
    }
    
    Remove-Item $PidsFile -ErrorAction SilentlyContinue
}
else {
    Write-Warning "No PIDs file found. Processes might not have been started via start-all.ps1"
}

# Fallback: stop processes by known dev ports if still running
$PortsToStop = @(8008, 5173, 3000)
foreach ($Port in $PortsToStop) {
    $netstatLines = netstat -ano | findstr ":$Port" | findstr "LISTENING"
    foreach ($line in $netstatLines) {
        $parts = $line -split "\s+"
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

# Stop Docker services (keep containers/volumes)
Write-Info "Stopping Docker services..."
Set-Location $ProjectRoot
docker compose stop

if ($LASTEXITCODE -eq 0) {
    Write-Success "Docker services stopped (containers preserved)"
}
else {
    Write-Warning "Docker services might not have been running"
}

Write-Success "`nAll services stopped!"
Write-Info "To start again, run: .\scripts\start-all.ps1"
