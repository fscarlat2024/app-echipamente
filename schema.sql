-- Schema inventar echipamente NCS (Cloudflare D1)
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS companies;

CREATE TABLE companies (
  id            TEXT PRIMARY KEY,
  nume          TEXT NOT NULL,
  contact       TEXT DEFAULT '',
  cui           TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  client_emails TEXT DEFAULT ''   -- email-uri client (lowercase, separate prin virgula) care pot vizualiza firma
);

CREATE TABLE equipment (
  id            TEXT PRIMARY KEY,
  nume          TEXT NOT NULL,
  tip           TEXT DEFAULT 'Altele',
  marca         TEXT DEFAULT '',
  serial        TEXT DEFAULT '',
  user          TEXT DEFAULT '',
  company_id    TEXT DEFAULT '',
  achizitie     TEXT DEFAULT '',
  garantie      TEXT DEFAULT '',
  status        TEXT DEFAULT 'Activ',
  procesor      TEXT DEFAULT '',
  memorie       TEXT DEFAULT '',
  stocare       TEXT DEFAULT '',
  os            TEXT DEFAULT '',
  cheie_windows TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  updated_at    INTEGER DEFAULT 0
);

CREATE INDEX idx_equipment_company ON equipment(company_id);

-- Firme demo
INSERT INTO companies (id, nume, contact, cui, note, client_emails) VALUES
 ('co_ajbrand', 'aj brand', '', '', '', ''),
 ('co_ncs', 'NCS intern', '', '', '', ''),
 ('co_scp', 'scpsincron', '', '', '', '');

-- Echipamente demo
INSERT INTO equipment (id, nume, tip, marca, serial, user, company_id, achizitie, garantie, status, note) VALUES
 ('eq_1','FortiGate 100F','Firewall','Fortinet FG-100F','FG100FTK25012345','Rack #2 Network','co_ajbrand','2024-03-12','2027-03-12','Activ','HA principal, SD-WAN dual ISP'),
 ('eq_2','FortiSwitch 124F','Switch','Fortinet FS-124F-POE','S124FTK25009911','Rack #2','co_ajbrand','2024-03-12','2026-10-01','Activ','Stack LAG catre FortiGate'),
 ('eq_3','FortiAP 231F','Access Point','Fortinet FAP-231F','FP231FTF2209AJ9N','Birou parter','co_ajbrand','2023-06-05','2026-06-05','Activ','Wi-Fi 6, canal 36 / 80MHz'),
 ('eq_4','FLORIN-NCS01','Laptop','Lenovo ThinkPad T14 Gen 6','PF668NF0','Florin S.','co_ncs','2025-01-20','2028-01-20','Activ','BitLocker XTS-AES256, Entra registered'),
 ('eq_5','NCS-DIANA','Desktop','Dell OptiPlex 7010','DL7010X92','Diana','co_ncs','2022-09-01','2025-09-01','Activ','De verificat BitLocker'),
 ('eq_6','NAS Synology DS1621+','NAS','Synology DS1621+','2140SQR004521','Server room','co_ncs','2024-02-10','2027-02-10','Activ','Backup imutabil WORM, 80TB SHR'),
 ('eq_7','UPS APC SMT1500','UPS','APC Smart-UPS 1500','AS1526110044','Rack #1','co_ncs','2021-05-15','2024-05-15','Activ','Baterie de inlocuit'),
 ('eq_8','HP LaserJet M428','Imprimantă','HP LaserJet Pro M428fdw','CNBRK12345','Contabilitate','co_scp','2023-11-03','2025-11-03','Activ','PCL v6, IP direct'),
 ('eq_9','Laptop rezervă 01','Laptop','HP EliteBook 840 G8','5CG1234ABC','','co_ncs','2022-04-01','2025-04-01','Rezervă','Reimaginat, gata de alocare'),
 ('eq_10','NCS-VECHI-07','Desktop','Dell Vostro 3670','DLV3670OLD','','co_ncs','2018-07-01','2021-07-01','Casat','Dezafectat, disc sters');
