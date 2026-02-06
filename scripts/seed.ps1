# Seed database with migrations and initial data on Windows
# PowerShell script for cross-platform development

# Import utility functions
. "$PSScriptRoot\common\colors.ps1"

$ErrorActionPreference = "Stop"

# Get the project root directory
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Info "🌱 Seeding Idento database..."

# Check if Docker is running
docker ps > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running. Please start Docker Desktop and try again."
    exit 1
}

# Run migrations
Write-Info "📝 Running database migrations..."
Set-Location (Join-Path $ProjectRoot "backend")

$env:DATABASE_URL = "postgres://idento:idento_password@localhost:5432/idento_db"

# Run migrate command
go run cmd/migrate/main.go

if ($LASTEXITCODE -ne 0) {
    Write-Error "Migrations failed"
    exit 1
}

Write-Success "✅ Migrations completed successfully"

# Load seed data
Write-Info "📊 Loading seed data..."
$SeedFile = Join-Path $ProjectRoot "backend\migrations\seed.sql"

if (Test-Path $SeedFile) {
    docker exec -i idento_db psql -U idento -d idento_db < $SeedFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "✅ Seed data loaded successfully"
    } else {
        Write-Warning "⚠️  Seed data might have already been loaded"
    }
} else {
    Write-Warning "Seed file not found at: $SeedFile"
}

Write-Success "`n🎉 Database seeding complete!"
Write-Info "You can now log in with: admin@test.com / password123"
