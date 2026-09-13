<#
.SYNOPSIS
  Crea (o actualiza) una tarea semanal de Windows que prende la PC si hace
  falta y corre meet-automation. El link de Meet, el horario y el día de
  clase ya están fijos en .env (MEET_URL, WINDOW_START_TIME/END_TIME) — este
  script solo se encarga de que el proceso arranque solo.

  Es un template: para otro profe/horario, copiá el proyecto (o su .env) y
  volvé a correr esto con otro -TaskName y -Time.

.PARAMETER TaskName
  Nombre de la tarea en Task Scheduler. Default: "MeetAutomation".

.PARAMETER DaysOfWeek
  Día(s) de la semana en que corre. Default: Saturday.
  Ejemplo para varios días: -DaysOfWeek Saturday,Sunday

.PARAMETER Time
  Hora de arranque del PROCESO (no de la clase) en formato HH:mm, 24hs.
  Se recomienda 15-20 min antes de WINDOW_START_TIME del .env, para dar
  margen a que la PC despierte y arranque Chrome antes de que empiece la
  ventana horaria.

.PARAMETER ProjectDir
  Carpeta raíz del proyecto. Default: la carpeta padre de este script.

.PARAMETER EndDate
  Última fecha (yyyy-MM-dd) en la que puede disparar la tarea — después de
  esa fecha deja de correr sola, sin tocar nada a mano. Opcional: si no se
  pasa, corre indefinidamente todas las semanas.

.EXAMPLE
  .\create-scheduled-task.ps1 -Time "09:40" -EndDate "2026-12-12"
  # Crea "MeetAutomation", corre los sábados 09:40, último sábado 2026-12-12.

.EXAMPLE
  .\create-scheduled-task.ps1 -TaskName "MeetAutomation-Ingles" -DaysOfWeek Saturday -Time "14:50"
#>
param(
  [string]$TaskName = "MeetAutomation",
  [System.DayOfWeek[]]$DaysOfWeek = @([System.DayOfWeek]::Saturday),
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$Time,
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [Nullable[DateTime]]$EndDate = $null
)

$ErrorActionPreference = "Stop"

$runnerScript = Join-Path $ProjectDir "scripts\run-scheduled.ps1"
if (-not (Test-Path $runnerScript)) {
  throw "No se encontró $runnerScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerScript`" -ProjectDir `"$ProjectDir`"" `
  -WorkingDirectory $ProjectDir

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DaysOfWeek -At $Time
if ($EndDate) {
  # Fin del día para que el último sábado incluido sí dispare.
  $trigger.EndBoundary = $EndDate.Date.AddHours(23).AddMinutes(59).ToString("yyyy-MM-ddTHH:mm:ss")
}

$settings = New-ScheduledTaskSettingsSet `
  -WakeToRun `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

# Interactive: necesita sesión con desktop real porque abre Chrome de verdad
# (no headless). La PC puede estar suspendida (WakeToRun la despierta) pero
# el usuario tiene que seguir logueado (no cerrar sesión ni apagar).
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Auto-join de meet-automation ($ProjectDir)" `
  -Force | Out-Null

$endMsg = if ($EndDate) { "hasta el $($EndDate.ToString('yyyy-MM-dd')) incluido" } else { "sin fecha de corte" }
Write-Host "Tarea '$TaskName' creada: corre $($DaysOfWeek -join ', ') a las $Time, $endMsg."
Write-Host "Wake-on-timer activado. Dejá la PC suspendida (no apagada) y con tu sesión iniciada."
Write-Host "Para deshabilitar una corrida puntual (feriado): Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para volver a habilitarla: Enable-ScheduledTask -TaskName '$TaskName'"
