# Start all Idento services on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

Write-Info "Starting Idento system on Windows..."

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Write-Info "Project root: $ProjectRoot"

# Start Docker services
Write-Success "Starting Docker services (PostgreSQL, Redis, PgAdmin)..."
Set-Location $ProjectRoot
docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start Docker services. Make sure Docker Desktop is running."
    exit 1
}

# Wait for database to be ready
Write-Warning "Waiting for database to be ready..."
Start-Sleep -Seconds 5

# Ensure dev defaults for backend/agent
if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable"
}
if (-not $env:JWT_SECRET) {
    $env:JWT_SECRET = "idento-dev-secret"
}

# Check if seed data exists
Write-Success "Checking seed data..."
$seedCountRaw = & docker exec idento_db psql -U idento -d idento_db -t -A -c "SELECT COUNT(*) FROM users;" 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Warning "Seed check failed; running migrations and seed data..."
    & "$PSScriptRoot\seed.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Seed failed; stopping startup"
        exit 1
    }
}
elseif ([int]$seedCountRaw -le 0) {
    Write-Warning "No users found; running migrations and seed data..."
    & "$PSScriptRoot\seed.ps1"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Seed failed; stopping startup"
        exit 1
    }
}
else {
    Write-Success "Database already seeded"
}

# Create logs directory if it doesn't exist
$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

# Start Backend
Write-Success "Starting Go Backend..."
$BackendPath = Join-Path $ProjectRoot "backend"
$BackendLog = Join-Path $LogsDir "backend.log"
$BackendErrLog = Join-Path $LogsDir "backend.error.log"

$BackendJob = Start-Process -FilePath "go" -ArgumentList "run", "main.go" -WorkingDirectory $BackendPath -WindowStyle Hidden -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendErrLog -PassThru

Write-Info "Backend PID: $($BackendJob.Id)"

# Wait a bit for backend to start
Start-Sleep -Seconds 2
$BackendProcess = Get-Process -Id $BackendJob.Id -ErrorAction SilentlyContinue
if (-not $BackendProcess) {
    Write-Error "Backend failed to start. Check logs\backend.error.log"
    exit 1
}

# Start Web Frontend
Write-Success "Starting Web Frontend..."
$WebPath = Join-Path $ProjectRoot "web"
$WebLog = Join-Path $LogsDir "web.log"
$WebErrLog = Join-Path $LogsDir "web.error.log"

# Install web dependencies if missing
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

Write-Info "Web PID: $($WebJob.Id)"

Start-Sleep -Seconds 2
$WebProcess = Get-Process -Id $WebJob.Id -ErrorAction SilentlyContinue
if (-not $WebProcess) {
    Write-Error "Web frontend failed to start. Check logs\web.error.log"
    exit 1
}

# Start Printing Agent
Write-Success "Starting Printing Agent..."
$AgentPath = Join-Path $ProjectRoot "agent"
$AgentLog = Join-Path $LogsDir "agent.log"
$AgentErrLog = Join-Path $LogsDir "agent.error.log"

$AgentJob = Start-Process -FilePath "go" -ArgumentList "run", "main.go" -WorkingDirectory $AgentPath -WindowStyle Hidden -RedirectStandardOutput $AgentLog -RedirectStandardError $AgentErrLog -PassThru

Write-Info "Agent PID: $($AgentJob.Id)"

Start-Sleep -Seconds 2
$AgentProcess = Get-Process -Id $AgentJob.Id -ErrorAction SilentlyContinue
if (-not $AgentProcess) {
    Write-Error "Agent failed to start. Check logs\agent.error.log"
    exit 1
}

# Save PIDs to file for easy stopping
$PidsFile = Join-Path $LogsDir "pids.txt"
"$($BackendJob.Id)`n$($WebJob.Id)`n$($AgentJob.Id)" | Out-File -FilePath $PidsFile -Encoding ASCII

Write-Success "`nAll services started successfully!"
Write-Info ""
Write-Info "==============================================="
Write-Success "Services:"
Write-Host "   Web:        http://localhost:5173"
Write-Host "   Backend:    http://localhost:8008"
Write-Host "   Agent:      http://localhost:3000"
Write-Host "   PgAdmin:    http://localhost:50050"
Write-Host "      Email:     admin@idento.com"
Write-Host "      Password:  admin"
Write-Host ""
Write-Success "Test Credentials:"
Write-Host "   Email:    admin@test.com"
Write-Host "   Password: password"
Write-Host ""
Write-Info "Logs:"
Write-Host "   Backend:  logs\backend.log"
Write-Host "   Backend:  logs\backend.error.log"
Write-Host "   Web:      logs\web.log"
Write-Host "   Web:      logs\web.error.log"
Write-Host "   Agent:    logs\agent.log"
Write-Host "   Agent:    logs\agent.error.log"
Write-Host ""
Write-Warning "To stop all services, run: .\scripts\stop-all.ps1"
Write-Info "Tip: set IDENTO_SKIP_PASSWORD_RESET=1 to skip resetting test passwords"
Write-Info "==============================================="

exit 0
