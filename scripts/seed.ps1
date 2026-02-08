# Seed database with migrations and initial data on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

$ErrorActionPreference = "Stop"

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Info "Seeding Idento database..."

# Check if Docker is running
docker ps > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

# Resolve mapped Postgres port from docker compose (fallback to 5438)
$DbPort = $env:IDENTO_DB_PORT
if (-not $DbPort) {
    $composeFile = Join-Path $ProjectRoot "docker-compose.yml"
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $portOutput = & docker compose -f $composeFile port db 5432 2>$null
    $ErrorActionPreference = $prevErrorAction
    if ($LASTEXITCODE -eq 0 -and $portOutput) {
        $DbPort = ($portOutput -split ':')[-1].Trim()
    } else {
        $DbPort = "5438"
    }
}

# Wait for database readiness (up to ~30s)
for ($i = 0; $i -lt 15; $i++) {
    docker exec idento_db pg_isready -U idento -d idento_db > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        break
    }
    Start-Sleep -Seconds 2
}

# Run migrations
Write-Info "Running database migrations..."
$MigratePath = Join-Path $ProjectRoot "backend\cmd\migrate"
Set-Location $MigratePath

if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "postgres://idento:idento_password@localhost:$DbPort/idento_db?sslmode=disable"
}

# Run migrate command
go run .

if ($LASTEXITCODE -ne 0) {
    Write-Error "Migrations failed"
    exit 1
}

Write-Success "Migrations completed successfully"

# Load seed data
Write-Info "Loading seed data..."
$SeedFile = Join-Path $ProjectRoot "backend\migrations\seed.sql"

if (Test-Path $SeedFile) {
    $seedContent = Get-Content -Raw -Encoding UTF8 $SeedFile
    $prevEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $seedContent | docker exec -i idento_db psql -v ON_ERROR_STOP=1 -U idento -d idento_db
    [Console]::OutputEncoding = $prevEncoding

    if ($LASTEXITCODE -eq 0) {
        $usersCountRaw = & docker exec idento_db psql -U idento -d idento_db -t -A -c "SELECT COUNT(*) FROM users;" 2>$null
        if ([int]$usersCountRaw -gt 0) {
            Write-Success "Seed data loaded successfully"
        } else {
            Write-Error "Seed completed but no users were inserted"
            exit 1
        }
    }
    else {
        Write-Error "Seed data failed"
        exit 1
    }
}
else {
    Write-Warning "Seed file not found at: $SeedFile"
}

Write-Success "`nDatabase seeding complete!"
if (-not $env:IDENTO_SKIP_PASSWORD_RESET) {
    Write-Info "Ensuring test passwords..."
    try {
        $prevLocation = Get-Location
        Set-Location $ProjectRoot
        go run .\backend\cmd\reset_password admin@test.com password | Out-Null
        go run .\backend\cmd\reset_password manager@test.com password | Out-Null
    } finally {
        if ($prevLocation) {
            Set-Location $prevLocation
        }
    }

    Write-Info "You can now log in with: admin@test.com / password"
} else {
    Write-Info "Password reset skipped (IDENTO_SKIP_PASSWORD_RESET is set)"
}
