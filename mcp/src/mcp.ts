// Serverul MCP: uneltele peste D1. Roluri (admin @netcomm.ro / client per firma).
// NU expune niciodata cheia Windows (cheie_windows).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

const TYPES = ["Laptop","Desktop","Server","Firewall","Switch","Access Point","Router","Imprimantă","Monitor","UPS","NAS","Telefon","Tabletă","Altele"];
const STATUSES = ["Activ","În service","Rezervă","Casat"];

// coloane expuse (FARA cheie_windows)
const EQ_COLS = "id,nume,tip,marca,serial,user,company_id,achizitie,garantie,status,procesor,memorie,stocare,os,note";

function txt(text: string) { return { content: [{ type: "text" as const, text }] }; }
function newId(p: string) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso + "T00:00:00Z");
  if (isNaN(t.getTime())) return null;
  const now = new Date(); now.setUTCHours(0, 0, 0, 0);
  return Math.round((t.getTime() - now.getTime()) / 86400000);
}
function warText(iso?: string): string {
  const d = daysUntil(iso);
  if (d === null) return "fără dată";
  if (d < 0) return `EXPIRATĂ de ${Math.abs(d)} zile (${iso})`;
  if (d <= 90) return `expiră în ${d} zile (${iso})`;
  return `validă (${iso})`;
}

function getEmail(): string {
  try {
    const a: any = getMcpAuthContext();
    return String(a?.props?.email || "").toLowerCase();
  } catch { return ""; }
}

async function resolveRole(env: any, email: string): Promise<{ kind: "admin" | "client" | "none"; companyIds: string[] }> {
  const adminDomain = String(env.ADMIN_DOMAIN || "").toLowerCase();
  if (email && adminDomain && email.endsWith("@" + adminDomain)) return { kind: "admin", companyIds: [] };
  if (!email) return { kind: "none", companyIds: [] };
  const rows = await env.DB.prepare("SELECT id, client_emails FROM companies").all();
  const ids: string[] = [];
  for (const r of (rows.results || [])) {
    const list = String(r.client_emails || "").toLowerCase().split(",").map((s: string) => s.trim()).filter(Boolean);
    if (list.includes(email)) ids.push(r.id);
  }
  return ids.length ? { kind: "client", companyIds: ids } : { kind: "none", companyIds: [] };
}

async function companyMap(env: any): Promise<Record<string, string>> {
  const cs = await env.DB.prepare("SELECT id, nume FROM companies").all();
  const m: Record<string, string> = {};
  for (const c of (cs.results || [])) m[c.id] = c.nume;
  return m;
}

function fmtEquip(r: any, cmap: Record<string, string>): string {
  const firma = r.company_id ? (cmap[r.company_id] || "necunoscută") : "nealocat";
  const parts = [
    `• ${r.nume} [${r.tip}] — ${r.status}`,
    `   Marcă/Model: ${r.marca || "-"} | Serial: ${r.serial || "-"}`,
    `   Utilizator: ${r.user || "-"} | Firmă: ${firma}`,
    `   Garanție: ${warText(r.garantie)}`,
  ];
  const tech = [r.procesor, r.memorie, r.stocare, r.os].filter(Boolean).join(" · ");
  if (tech) parts.push(`   Tehnic: ${tech}`);
  if (r.note) parts.push(`   Note: ${r.note}`);
  return parts.join("\n");
}

function scopeSql(role: { kind: string; companyIds: string[] }): { where: string; binds: string[] } {
  if (role.kind === "client" && role.companyIds.length) {
    const ph = role.companyIds.map(() => "?").join(",");
    return { where: ` AND company_id IN (${ph})`, binds: role.companyIds };
  }
  return { where: "", binds: [] };
}

export function buildServer(env: any): McpServer {
  const server = new McpServer({ name: "inventar-echipamente", version: "1.0.0" });

  // ---- LISTA FIRME ----
  server.registerTool(
    "lista_firme",
    { description: "Listează firmele/clienții și câte echipamente are fiecare.", inputSchema: {} },
    async () => {
      const email = getEmail();
      const role = await resolveRole(env, email);
      if (role.kind === "none") return txt("Nu ai acces la inventar.");
      const cs = await env.DB.prepare("SELECT id,nume,contact,cui FROM companies ORDER BY nume").all();
      let list = cs.results || [];
      if (role.kind === "client") list = list.filter((c: any) => role.companyIds.includes(c.id));
      if (!list.length) return txt("Nicio firmă.");
      const counts = await env.DB.prepare("SELECT company_id, COUNT(*) n FROM equipment GROUP BY company_id").all();
      const cmap: Record<string, number> = {};
      for (const r of (counts.results || [])) cmap[r.company_id] = r.n;
      const lines = list.map((c: any) => `• ${c.nume} — ${cmap[c.id] || 0} echip.${c.contact ? " | " + c.contact : ""}${c.cui ? " | " + c.cui : ""}`);
      return txt(`Firme (${list.length}):\n` + lines.join("\n"));
    }
  );

  // ---- SUMAR INVENTAR ----
  server.registerTool(
    "sumar_inventar",
    { description: "Sumar statistic: total, pe tip, pe status, garanții expirate/care expiră.", inputSchema: {} },
    async () => {
      const role = await resolveRole(env, getEmail());
      if (role.kind === "none") return txt("Nu ai acces la inventar.");
      const sc = scopeSql(role);
      const rows = await env.DB.prepare(`SELECT ${EQ_COLS} FROM equipment WHERE 1=1${sc.where}`).bind(...sc.binds).all();
      const data = rows.results || [];
      const byTip: Record<string, number> = {}, byStatus: Record<string, number> = {};
      let exp = 0, soon = 0;
      for (const r of data) {
        byTip[r.tip] = (byTip[r.tip] || 0) + 1;
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        if (r.status !== "Casat") { const d = daysUntil(r.garantie); if (d !== null) { if (d < 0) exp++; else if (d <= 90) soon++; } }
      }
      const t = Object.keys(byTip).sort().map(k => `   ${k}: ${byTip[k]}`).join("\n");
      const s = Object.keys(byStatus).sort().map(k => `   ${k}: ${byStatus[k]}`).join("\n");
      return txt(`Total echipamente: ${data.length}\n\nPe tip:\n${t}\n\nPe status:\n${s}\n\nGaranții expirate: ${exp}\nGaranții care expiră ≤90 zile: ${soon}`);
    }
  );

  // ---- CAUTA ECHIPAMENTE ----
  server.registerTool(
    "cauta_echipamente",
    {
      description: "Caută echipamente după text liber (nume/serial/marcă/utilizator) și/sau filtre.",
      inputSchema: {
        q: z.string().optional().describe("text căutat"),
        tip: z.string().optional(),
        status: z.string().optional(),
        firma: z.string().optional().describe("nume firmă"),
        limit: z.number().optional(),
      },
    },
    async ({ q, tip, status, firma, limit }) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind === "none") return txt("Nu ai acces la inventar.");
      const cmap = await companyMap(env);
      const binds: any[] = [];
      let where = "1=1";
      if (tip) { where += " AND tip=?"; binds.push(tip); }
      if (status) { where += " AND status=?"; binds.push(status); }
      if (firma) {
        const c = await env.DB.prepare("SELECT id FROM companies WHERE lower(nume) LIKE ?").bind("%" + firma.toLowerCase() + "%").first();
        if (!c) return txt(`Firma "${firma}" nu a fost găsită.`);
        where += " AND company_id=?"; binds.push(c.id);
      }
      if (q) {
        where += " AND (lower(nume) LIKE ?1 OR lower(serial) LIKE ?1 OR lower(marca) LIKE ?1 OR lower(user) LIKE ?1 OR lower(note) LIKE ?1)";
        binds.push("%" + q.toLowerCase() + "%");
      }
      const sc = scopeSql(role); where += sc.where; binds.push(...sc.binds);
      const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const rows = await env.DB.prepare(`SELECT ${EQ_COLS} FROM equipment WHERE ${where} ORDER BY nume LIMIT ${lim}`).bind(...binds).all();
      const data = rows.results || [];
      if (!data.length) return txt("Niciun echipament găsit.");
      return txt(`${data.length} echipamente:\n\n` + data.map((r: any) => fmtEquip(r, cmap)).join("\n\n"));
    }
  );

  // ---- ECHIPAMENTE FIRMA ----
  server.registerTool(
    "echipamente_firma",
    { description: "Toate echipamentele unei firme.", inputSchema: { firma: z.string().describe("nume firmă") } },
    async ({ firma }) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind === "none") return txt("Nu ai acces la inventar.");
      const c = await env.DB.prepare("SELECT id,nume FROM companies WHERE lower(nume) LIKE ?").bind("%" + firma.toLowerCase() + "%").first();
      if (!c) return txt(`Firma "${firma}" nu a fost găsită.`);
      if (role.kind === "client" && !role.companyIds.includes(c.id)) return txt("Nu ai acces la această firmă.");
      const cmap = await companyMap(env);
      const rows = await env.DB.prepare(`SELECT ${EQ_COLS} FROM equipment WHERE company_id=? ORDER BY nume`).bind(c.id).all();
      const data = rows.results || [];
      if (!data.length) return txt(`Firma ${c.nume} nu are echipamente.`);
      return txt(`Echipamente ${c.nume} (${data.length}):\n\n` + data.map((r: any) => fmtEquip(r, cmap)).join("\n\n"));
    }
  );

  // ---- GARANTII CARE EXPIRA ----
  server.registerTool(
    "garantii_care_expira",
    { description: "Echipamentele cu garanția expirată sau care expiră într-un număr de zile (implicit 90).", inputSchema: { zile: z.number().optional() } },
    async ({ zile }) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind === "none") return txt("Nu ai acces la inventar.");
      const prag = Number(zile) || 90;
      const cmap = await companyMap(env);
      const sc = scopeSql(role);
      const rows = await env.DB.prepare(`SELECT ${EQ_COLS} FROM equipment WHERE status<>'Casat'${sc.where}`).bind(...sc.binds).all();
      const data = (rows.results || []).filter((r: any) => { const d = daysUntil(r.garantie); return d !== null && d <= prag; })
        .sort((a: any, b: any) => (daysUntil(a.garantie)! - daysUntil(b.garantie)!));
      if (!data.length) return txt(`Nicio garanție expirată sau care expiră în ≤${prag} zile.`);
      const lines = data.map((r: any) => `• ${r.nume} (${r.serial || "-"}) — ${cmap[r.company_id] || "nealocat"} — ${warText(r.garantie)}`);
      return txt(`Garanții (prag ${prag} zile) — ${data.length}:\n` + lines.join("\n"));
    }
  );

  // ---- DETALII ECHIPAMENT ----
  server.registerTool(
    "detalii_echipament",
    { description: "Detaliile unui echipament după nume sau serial.", inputSchema: { termen: z.string().describe("nume sau serial") } },
    async ({ termen }) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind === "none") return txt("Nu ai acces la inventar.");
      const cmap = await companyMap(env);
      const sc = scopeSql(role);
      const rows = await env.DB.prepare(`SELECT ${EQ_COLS} FROM equipment WHERE (lower(nume) LIKE ?1 OR lower(serial) LIKE ?1)${sc.where}`)
        .bind("%" + termen.toLowerCase() + "%", ...sc.binds).all();
      const data = rows.results || [];
      if (!data.length) return txt(`Niciun echipament pentru "${termen}".`);
      return txt(data.map((r: any) => fmtEquip(r, cmap)).join("\n\n"));
    }
  );

  // ================= SCRIERE (doar admin) =================

  server.registerTool(
    "adauga_echipament",
    {
      description: "Adaugă un echipament nou (doar admin).",
      inputSchema: {
        nume: z.string(), tip: z.string().optional(), marca: z.string().optional(), serial: z.string().optional(),
        utilizator: z.string().optional(), firma: z.string().optional(), achizitie: z.string().optional().describe("YYYY-MM-DD"),
        garantie: z.string().optional().describe("YYYY-MM-DD"), status: z.string().optional(),
        procesor: z.string().optional(), memorie: z.string().optional(), stocare: z.string().optional(), os: z.string().optional(), note: z.string().optional(),
      },
    },
    async (a: any) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind !== "admin") return txt("Doar administratorii pot adăuga echipamente.");
      let companyId = "";
      if (a.firma) {
        const c = await env.DB.prepare("SELECT id FROM companies WHERE lower(nume) LIKE ?").bind("%" + a.firma.toLowerCase() + "%").first();
        if (!c) return txt(`Firma "${a.firma}" nu există. Creeaz-o întâi cu adauga_firma.`);
        companyId = c.id;
      }
      const id = newId("eq_");
      const tip = TYPES.includes(a.tip) ? a.tip : (a.tip || "Altele");
      const status = STATUSES.includes(a.status) ? a.status : "Activ";
      await env.DB.prepare(
        "INSERT INTO equipment (id,nume,tip,marca,serial,user,company_id,achizitie,garantie,status,procesor,memorie,stocare,os,cheie_windows,note,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(id, a.nume, tip, a.marca || "", a.serial || "", a.utilizator || "", companyId, a.achizitie || "", a.garantie || "", status,
        a.procesor || "", a.memorie || "", a.stocare || "", a.os || "", "", a.note || "", Date.now()).run();
      return txt(`Adăugat: ${a.nume} [${tip}] (id ${id}).`);
    }
  );

  server.registerTool(
    "editeaza_echipament",
    {
      description: "Editează un echipament existent (căutat după nume sau serial exact). Doar admin. Trimite doar câmpurile de schimbat.",
      inputSchema: {
        termen: z.string().describe("nume sau serial exact al echipamentului"),
        nume: z.string().optional(), tip: z.string().optional(), marca: z.string().optional(), serial: z.string().optional(),
        utilizator: z.string().optional(), firma: z.string().optional(), achizitie: z.string().optional(),
        garantie: z.string().optional(), status: z.string().optional(),
        procesor: z.string().optional(), memorie: z.string().optional(), stocare: z.string().optional(), os: z.string().optional(), note: z.string().optional(),
      },
    },
    async (a: any) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind !== "admin") return txt("Doar administratorii pot edita echipamente.");
      const found = await env.DB.prepare("SELECT * FROM equipment WHERE lower(nume)=?1 OR lower(serial)=?1").bind(a.termen.toLowerCase()).all();
      const rows = found.results || [];
      if (!rows.length) return txt(`Niciun echipament pentru "${a.termen}".`);
      if (rows.length > 1) return txt(`Mai multe potriviri pentru "${a.termen}" (${rows.length}). Fii mai specific (serial).`);
      const it = rows[0];
      const map: Record<string, string> = { nume: "nume", tip: "tip", marca: "marca", serial: "serial", utilizator: "user", achizitie: "achizitie", garantie: "garantie", status: "status", procesor: "procesor", memorie: "memorie", stocare: "stocare", os: "os", note: "note" };
      const sets: string[] = []; const binds: any[] = [];
      for (const k of Object.keys(map)) { if (a[k] !== undefined) { sets.push(`${map[k]}=?`); binds.push(a[k]); } }
      if (a.firma !== undefined) {
        const c = await env.DB.prepare("SELECT id FROM companies WHERE lower(nume) LIKE ?").bind("%" + String(a.firma).toLowerCase() + "%").first();
        if (!c) return txt(`Firma "${a.firma}" nu există.`);
        sets.push("company_id=?"); binds.push(c.id);
      }
      if (!sets.length) return txt("Nimic de modificat.");
      sets.push("updated_at=?"); binds.push(Date.now());
      binds.push(it.id);
      await env.DB.prepare(`UPDATE equipment SET ${sets.join(",")} WHERE id=?`).bind(...binds).run();
      return txt(`Actualizat: ${it.nume} (${sets.length - 1} câmpuri).`);
    }
  );

  server.registerTool(
    "adauga_firma",
    {
      description: "Adaugă o firmă/client nou (doar admin).",
      inputSchema: { nume: z.string(), contact: z.string().optional(), cui: z.string().optional(), emailuri_client: z.string().optional().describe("email-uri separate prin virgulă, pot vedea doar firma lor") },
    },
    async (a: any) => {
      const role = await resolveRole(env, getEmail());
      if (role.kind !== "admin") return txt("Doar administratorii pot adăuga firme.");
      const dup = await env.DB.prepare("SELECT id FROM companies WHERE lower(nume)=?").bind(a.nume.toLowerCase()).first();
      if (dup) return txt(`Firma "${a.nume}" există deja.`);
      const id = newId("co_");
      await env.DB.prepare("INSERT INTO companies (id,nume,contact,cui,note,client_emails) VALUES (?,?,?,?,?,?)")
        .bind(id, a.nume, a.contact || "", a.cui || "", "", (a.emailuri_client || "").toLowerCase()).run();
      return txt(`Firmă adăugată: ${a.nume} (id ${id}).`);
    }
  );

  return server;
}
