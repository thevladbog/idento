# Start all Idento services on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

Write-Info "🚀 Starting Idento system on Windows..."

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Write-Info "📂 Project root: $ProjectRoot"

# Start Docker services
Write-Success "🐳 Starting Docker services (PostgreSQL, Redis, PgAdmin)..."
Set-Location $ProjectRoot
docker compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Error "❌ Failed to start Docker services. Make sure Docker Desktop is running."
    exit 1
}

# Wait for database to be ready
Write-Warning "⏳ Waiting for database to be ready..."
Start-Sleep -Seconds 5

# Check if seed data exists
Write-Success "🌱 Checking seed data..."
$seedCheck = docker exec idento_db psql -U idento -d idento_db -c "SELECT COUNT(*) FROM users;" 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Warning "📝 Running migrations and seed data..."
    & "$PSScriptRoot\seed.ps1"
} else {
    Write-Success "✅ Database already seeded"
}

# Create logs directory if it doesn't exist
$LogsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
}

# Start Backend
Write-Success "🔧 Starting Go Backend..."
$BackendPath = Join-Path $ProjectRoot "backend"
$BackendLog = Join-Path $LogsDir "backend.log"

$BackendJob = Start-Process -FilePath "go" -ArgumentList "run", "main.go" -WorkingDirectory $BackendPath -WindowStyle Hidden -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendLog -PassThru

Write-Info "Backend PID: $($BackendJob.Id)"

# Wait a bit for backend to start
Start-Sleep -Seconds 2

# Start Web Frontend
Write-Success "🌐 Starting Web Frontend..."
$WebPath = Join-Path $ProjectRoot "web"
$WebLog = Join-Path $LogsDir "web.log"

$WebJob = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $WebPath -WindowStyle Hidden -RedirectStandardOutput $WebLog -RedirectStandardError $WebLog -PassThru

Write-Info "Web PID: $($WebJob.Id)"

# Start Printing Agent
Write-Success "🖨️  Starting Printing Agent..."
$AgentPath = Join-Path $ProjectRoot "agent"
$AgentLog = Join-Path $LogsDir "agent.log"

$AgentJob = Start-Process -FilePath "go" -ArgumentList "run", "main.go" -WorkingDirectory $AgentPath -WindowStyle Hidden -RedirectStandardOutput $AgentLog -RedirectStandardError $AgentLog -PassThru

Write-Info "Agent PID: $($AgentJob.Id)"

# Save PIDs to file for easy stopping
$PidsFile = Join-Path $LogsDir "pids.txt"
"$($BackendJob.Id)`n$($WebJob.Id)`n$($AgentJob.Id)" | Out-File -FilePath $PidsFile -Encoding ASCII

Write-Success "`n✅ All services started successfully!"
Write-Info ""
Write-Info "═══════════════════════════════════════════════"
Write-Success "📊 Services:"
Write-Host "   🌐 Web:        http://localhost:5173"
Write-Host "   🔧 Backend:    http://localhost:8080"
Write-Host "   🖨️  Agent:      http://localhost:3000"
Write-Host "   🗄️  PgAdmin:    http://localhost:5050"
Write-Host "      Email:     admin@idento.com"
Write-Host "      Password:  admin"
Write-Host ""
Write-Success "🔑 Test Credentials:"
Write-Host "   Email:    admin@test.com"
Write-Host "   Password: password123"
Write-Host ""
Write-Info "📋 Logs:"
Write-Host "   Backend:  logs\backend.log"
Write-Host "   Web:      logs\web.log"
Write-Host "   Agent:    logs\agent.log"
Write-Host ""
Write-Warning "⚠️  To stop all services, run: .\scripts\stop-all.ps1"
Write-Info "═══════════════════════════════════════════════"
