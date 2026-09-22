# Colectare inventar echipament -> app.netcomm.ro/api/ingest
# Intune Proactive Remediation - scriptul de DETECTIE. Ruleaza ca SYSTEM, 64-bit.
# Culege nativ (CIM/WMI) datele tip Belarc si le trimite in inventarul NCS.
# Inlocuieste __INGEST_TOKEN__ cu tokenul firmei (generat in Claude: "creeaza token ingest pentru firma X").

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Endpoint = "https://app.netcomm.ro/api/ingest"
$Token    = "__INGEST_TOKEN__"

try {
    $cs   = Get-CimInstance Win32_ComputerSystem
    $bios = Get-CimInstance Win32_BIOS
    $os   = Get-CimInstance Win32_OperatingSystem
    $cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1

    $ramGB = [math]::Round(($cs.TotalPhysicalMemory / 1GB), 0)
    $diskBytes = (Get-CimInstance Win32_DiskDrive | Measure-Object -Property Size -Sum).Sum
    $diskGB = if ($diskBytes) { [math]::Round(($diskBytes / 1GB), 0) } else { 0 }

    # tip din chassis
    $chassis = (Get-CimInstance Win32_SystemEnclosure).ChassisTypes | Select-Object -First 1
    $tip = "Desktop"
    if ($chassis -in 8,9,10,11,12,14,18,21,30,31,32) { $tip = "Laptop" }
    elseif ($chassis -in 17,23,28) { $tip = "Server" }

    # cheie Windows OEM (poate lipsi pe non-OEM)
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
    $resp = Invoke-RestMethod -Uri $Endpoint -Method Post `
        -Headers @{ "Authorization" = "Bearer $Token" } `
        -ContentType "application/json; charset=utf-8" -Body $json -TimeoutSec 30

    Write-Output ("OK {0}: inserted={1} updated={2}" -f $device.nume, $resp.inserted, $resp.updated)
    exit 0
}
catch {
    Write-Output ("Eroare inventar: " + $_.Exception.Message)
    exit 0
}
