# Restart Idento Printing Agent on Windows
# PowerShell script for targeted restart

. "$PSScriptRoot\common\colors.ps1"

Write-Info "Restarting Idento Printing Agent..."

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

$agentPid = $existing[2]
if ($agentPid -match '^\d+$') {
  try {
    $proc = Get-Process -Id $agentPid -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id $agentPid -Force
      Write-Success "Stopped agent process $agentPid ($($proc.ProcessName))"
    }
  }
  catch {
    Write-Warning "Agent PID $agentPid not found"
  }
}
else {
  Write-Warning "Agent PID not found in logs\pids.txt"
}

# Fallback stop by port if needed (agent default is 12345; legacy scripts show 3000)
Stop-ProcessByPort -Port 12345
Stop-ProcessByPort -Port 3000

$AgentPath = Join-Path $ProjectRoot "..\agent"
$AgentLog = Join-Path $LogsDir "agent.log"
$AgentErrLog = Join-Path $LogsDir "agent.error.log"
$AgentBinary = Join-Path $AgentPath "idento-agent.exe"

Write-Info "Building agent binary..."
& go build -o $AgentBinary
if ($LASTEXITCODE -ne 0) {
  Write-Error "Agent build failed. Check output above."
  exit 1
}

$AgentJob = Start-Process -FilePath $AgentBinary -WorkingDirectory $AgentPath -WindowStyle Hidden -RedirectStandardOutput $AgentLog -RedirectStandardError $AgentErrLog -PassThru

Start-Sleep -Seconds 2
$AgentProcess = Get-Process -Id $AgentJob.Id -ErrorAction SilentlyContinue
if (-not $AgentProcess) {
  Write-Error "Agent failed to start. Check logs\agent.error.log"
  exit 1
}

$existing[2] = [string]$AgentJob.Id
Save-Pids -Pids $existing

Write-Success "Agent restarted successfully (PID: $($AgentJob.Id))"
