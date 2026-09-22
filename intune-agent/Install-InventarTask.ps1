# Instalator agent inventar (Intune Platform Script - orice licenta, inclusiv Business Premium).
# Ruleaza o data ca SYSTEM la asignare; instaleaza un scheduled task zilnic care culege
# datele (tip Belarc) si le trimite in inventarul NCS. Reruleaza-l (re-upload) pt update.
# Inlocuieste __INGEST_TOKEN__ cu tokenul firmei (Claude: "creeaza token ingest pentru firma X").

$ErrorActionPreference = "Stop"
$Token    = "__INGEST_TOKEN__"
$Endpoint = "https://app.netcomm.ro/api/ingest"
$dir      = "C:\ProgramData\NCS-Inventar"
$script   = Join-Path $dir "Colectare-Inventar.ps1"
$taskName = "NCS-Inventar"

New-Item -ItemType Directory -Path $dir -Force | Out-Null

# Continutul scriptului de colectare (rulat de task-ul programat)
$collector = @'
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Endpoint = "@ENDPOINT@"
$Token    = "@TOKEN@"
try {
    $cs   = Get-CimInstance Win32_ComputerSystem
    $bios = Get-CimInstance Win32_BIOS
    $os   = Get-CimInstance Win32_OperatingSystem
    $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1
    $ramGB = [math]::Round(($cs.TotalPhysicalMemory / 1GB), 0)
    $diskBytes = (Get-CimInstance Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum
    $diskGB = if ($diskBytes) { [math]::Round(($diskBytes / 1GB), 0) } else { 0 }
    $chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes | Select-Object -First 1
    $tip = "Desktop"
    if ($chassis -in 8,9,10,11,12,14,18,21,30,31,32) { $tip = "Laptop" }
    elseif ($chassis -in 17,23,28) { $tip = "Server" }
    $key = ""
    try { $key = (Get-CimInstance -ClassName SoftwareLicensingService).OA3xOriginalProductKey } catch {}
    $marca = (("{0} {1}" -f $cs.Manufacturer, $cs.Model) -replace '\s+', ' ').Trim()
    $device = [ordered]@{
        nume         = $env:COMPUTERNAME
        tip          = $tip
        marca        = $marca
        serial       = ($bios.SerialNumber).Trim()
        user         = [string]$cs.UserName
        os           = $os.Caption
        procesor     = ($cpu.Name -replace '\s+', ' ').Trim()
        memorie      = "$ramGB GB"
        stocare      = "$diskGB GB"
        cheieWindows = [string]$key
    }
    $json = $device | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $Endpoint -Method Post -Headers @{ "Authorization" = "Bearer $Token" } -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 30 | Out-Null
} catch {
    # esec silentios (retry la urmatorul ciclu)
}
'@
$collector = $collector.Replace("@ENDPOINT@", $Endpoint).Replace("@TOKEN@", $Token)
Set-Content -Path $script -Value $collector -Encoding UTF8

# Scheduled task zilnic + la pornire, ca SYSTEM, cu jitter ca sa nu loveasca toate PC-urile odata
$action    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"" + $script + "`"")
$trigDaily = New-ScheduledTaskTrigger -Daily -At 12:00pm
$trigDaily.RandomDelay = "PT3H"
$trigStart = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "S-1-5-18" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigDaily, $trigStart) -Principal $principal -Settings $settings -Force | Out-Null

# Ruleaza o data acum (raportare imediata)
Start-ScheduledTask -TaskName $taskName

Write-Output "Agent inventar NCS instalat (task $taskName)."
exit 0
