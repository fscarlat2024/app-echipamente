# Agent inventar prin Intune (Proactive Remediation)

Culege automat datele hardware/software (tip Belarc) de pe PC-urile unui client, nativ din Windows (fara Belarc), si le trimite in inventarul NCS (`app.netcomm.ro`). Fiecare echipament intra **automat la firma clientului**, potrivit dupa serial.

## Cum functioneaza
- Scriptul de detectie (`Colectare-Inventar.ps1`) ruleaza recurent pe PC (ca SYSTEM), culege CIM/WMI si face `POST https://app.netcomm.ro/api/ingest`.
- Autentificare: un **token per client** (header `Authorization: Bearer <token>`), mapat in baza la firma clientului.
- Worker-ul face upsert dupa serial: PC nou = adaugat; PC existent = actualizat (hardware + firma), fara sa atinga garantie/status/note gestionate manual.

## Pasi de configurare (o singura data per client)

### 1. Bypass in Cloudflare Access pentru calea /api/ingest
`app.netcomm.ro` e in spatele Access; masinile nu pot face login. Adauga o aplicatie Access care lasa liber DOAR calea de ingest:
- Zero Trust -> Access -> Applications -> **Add an application** -> **Self-hosted**
- Public hostname: subdomeniu `app`, domeniu `netcomm.ro`, **Path**: `api/ingest`
- Policy: **Bypass**, Include -> **Everyone**
- Save. (Aplicatia mai specifica pe path castiga fata de "inventa ncs", deci restul aplicatiei ramane protejat.)

Securitatea caii ramane data de token (necunoscut = 401).

### 2. Genereaza tokenul firmei
In Claude (conectorul Inventar Echipamente): *"creeaza token ingest pentru firma <NUME>"*.
Copiaza tokenul afisat (o singura data).

### 3. Pune tokenul in script
In `Colectare-Inventar.ps1`, inlocuieste `__INGEST_TOKEN__` cu tokenul clientului.

### 4. Incarca in Intune (tenantul clientului)

**VARIANTA B - Platform Script (RECOMANDAT, orice licenta inclusiv Business Premium):**
- Pune tokenul in `Install-InventarTask.ps1` (inlocuieste `__INGEST_TOKEN__`).
- Intune -> **Devices -> Scripts and remediations -> Platform scripts** -> **Add -> Windows 10 and later**
- Script file: `Install-InventarTask.ps1`
- Run this script using the logged-on credentials: **No** (SYSTEM)
- Enforce script signature check: **No**
- Run script in 64-bit PowerShell: **Yes**
- **Assignments**: grupul de device-uri al clientului.
- Scriptul instaleaza pe fiecare PC un scheduled task `NCS-Inventar` care raporteaza zilnic (+ la pornire). Ruleaza si o data imediat.
- Local (test/PC propriu, ca Admin): `powershell -ExecutionPolicy Bypass -File Install-InventarTask.ps1`

**VARIANTA A - Remediations (doar daca ai Windows/M365 E3/E5 + license verification ON):**
- Intune -> **Devices -> Scripts and remediations -> Remediations** -> **Create**
- Detection: `Colectare-Inventar.ps1` (cu token) · Remediation: `Remediere.ps1`
- Run as SYSTEM (logged-on: No), 64-bit: Yes, signature: No
- Assign la grup, Schedule: Daily.
- NOTA: butonul Create e gri daca "Windows license verification" nu e activat (Reports -> Endpoint analytics -> Settings) sau tenantul n-are E3/E5.

Dupa prima rulare, echipamentele apar in `app.netcomm.ro` la firma clientului si in conectorul Claude.

## Note
- Serialul (Win32_BIOS) = cel real -> se leaga direct de verificarea garantiei Lenovo din app.
- Cheia Windows OEM se colecteaza (OA3xOriginalProductKey) si se stocheaza; conectorul Claude NU o afiseaza.
- Un token per client = revocabil independent (in Claude: *"revoca token ingest pentru firma X"*).
- Proactive Remediations cer licentiere Windows E3/E5 sau add-on Intune pe tenantul clientului.
