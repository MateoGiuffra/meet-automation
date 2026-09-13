<#
.SYNOPSIS
  Wrapper que ejecuta meet-automation y logea stdout/stderr a un archivo.
  Pensado para ser invocado por una tarea de Windows Task Scheduler
  (creada con create-scheduled-task.ps1), pero corre igual de bien a mano.

.PARAMETER ProjectDir
  Carpeta raíz del proyecto (donde está package.json y .env). Default: la
  carpeta padre de este script.

.PARAMETER LogDir
  Carpeta donde se guardan los logs de cada corrida. Default: logs\scheduled
  dentro del proyecto.
#>
param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$LogDir = (Join-Path $ProjectDir "logs\scheduled")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logFile = Join-Path $LogDir "run-$timestamp.log"

Set-Location $ProjectDir

$tsx = Join-Path $ProjectDir "node_modules\.bin\tsx.CMD"
if (-not (Test-Path $tsx)) {
  "ERROR: no se encontró $tsx. ¿Corriste 'pnpm install'?" | Out-File -FilePath $logFile -Encoding utf8
  exit 1
}

& $tsx "src/index.ts" *>> $logFile
exit $LASTEXITCODE
