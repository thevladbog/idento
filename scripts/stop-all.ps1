# Stop all Idento services on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

Write-Info "🛑 Stopping Idento system on Windows..."

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogsDir = Join-Path $ProjectRoot "logs"
$PidsFile = Join-Path $LogsDir "pids.txt"

# Stop processes from PID file
if (Test-Path $PidsFile) {
    Write-Info "Stopping processes..."
    $Pids = Get-Content $PidsFile
    
    foreach ($Pid in $Pids) {
        if ($Pid -match '^\d+$') {
            try {
                $Process = Get-Process -Id $Pid -ErrorAction SilentlyContinue
                if ($Process) {
                    Stop-Process -Id $Pid -Force
                    Write-Success "✅ Stopped process $Pid ($($Process.ProcessName))"
                }
            } catch {
                Write-Warning "Process $Pid not found (might have already stopped)"
            }
        }
    }
    
    Remove-Item $PidsFile -ErrorAction SilentlyContinue
} else {
    Write-Warning "No PIDs file found. Processes might not have been started via start-all.ps1"
}

# Stop Docker services
Write-Info "🐳 Stopping Docker services..."
Set-Location $ProjectRoot
docker compose down

if ($LASTEXITCODE -eq 0) {
    Write-Success "✅ Docker services stopped"
} else {
    Write-Warning "⚠️  Docker services might not have been running"
}

Write-Success "`n🎉 All services stopped!"
Write-Info "To start again, run: .\scripts\start-all.ps1"
