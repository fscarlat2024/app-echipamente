# Inventar Echipamente NCS

Aplicație web single-page pentru inventar echipamente IT (Net Communications Systems).

## Ce face
- Adăugare / editare / ștergere echipamente (nume, tip, marcă, serial, utilizator, firmă, garanție, status, detalii tehnice)
- **Firme**: creezi firme și aloci echipamentele; contor echipamente per firmă
- **Import din Belarc**: lipești raportul Belarc (text) sau încarci fișierul .html/.txt → extrage automat nume, model, serial, procesor, memorie, stocare, Windows + cheie
- Dashboard cu KPI-uri + **alerte expirare garanție** (≤90 zile, expirată)
- Căutare + filtre (tip / status / firmă / garanție), sortare pe coloane
- Export CSV + backup JSON (include și firmele), import JSON
- Temă zi/noapte, culori NCS
- Date salvate local în browser (localStorage) — per dispozitiv. Fă export JSON pentru backup.

## Structură
- `public/index.html` — aplicația (un singur fișier, fără dependențe externe la runtime)
- `wrangler.jsonc` — config deploy Cloudflare (static assets din `public/`)

## Deploy pe Cloudflare
```
cd C:\Users\florin\net\app-echipamente
npx wrangler deploy
```
Rezultă un URL `https://app-echipamente.<subdomeniu>.workers.dev`.
Pentru domeniu propriu: worker → Settings → Domains & Routes → Add → `app.netcomm.ro`.

## Securitate
Inventarul conține seriale și chei Windows. Accesul se protejează cu **Cloudflare Access**
(Zero Trust → Access → Applications) — login obligatoriu înainte de a vedea pagina.
