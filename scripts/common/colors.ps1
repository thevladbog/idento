# Common PowerShell utility functions for Idento scripts

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Blue
}

function Write-Warning {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

function Get-ProjectRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Test-CommandExists {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

if ($MyInvocation.PSScriptRoot -and $MyInvocation.InvocationName -ne '.') {
    Export-ModuleMember -Function Write-Success, Write-Info, Write-Warning, Write-Error, Get-ProjectRoot, Test-CommandExists
}
