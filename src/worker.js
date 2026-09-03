// Inventar Echipamente NCS - Cloudflare Worker
// API + roluri. Auth prin Cloudflare Access (JWT verificat cand TEAM_DOMAIN + ACCESS_AUD sunt setate).
// Roluri: admin (email @ADMIN_DOMAIN sau in ADMIN_EMAILS) = vede/editeaza tot;
//         client (email listat in companies.client_emails) = vede DOAR firma sa, read-only.

const EQ_COLS = ["id","nume","tip","marca","serial","user","company_id","achizitie","garantie","status","procesor","memorie","stocare","os","cheie_windows","note"];

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function newId(pfx) { return pfx + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function eqToApi(r) {
  return {
    id: r.id, nume: r.nume, tip: r.tip, marca: r.marca, serial: r.serial, user: r.user,
    companyId: r.company_id, achizitie: r.achizitie, garantie: r.garantie, status: r.status,
    procesor: r.procesor, memorie: r.memorie, stocare: r.stocare, os: r.os,
    cheieWindows: r.cheie_windows, note: r.note
  };
}
function coToApi(r, includeEmails) {
  var o = { id: r.id, nume: r.nume, contact: r.contact, cui: r.cui, note: r.note };
  if (includeEmails) o.clientEmails = r.client_emails || "";
  return o;
}
function apiToEqValues(b) {
  return [
    b.id, str(b.nume), str(b.tip) || "Altele", str(b.marca), str(b.serial), str(b.user),
    str(b.companyId), str(b.achizitie), str(b.garantie), str(b.status) || "Activ",
    str(b.procesor), str(b.memorie), str(b.stocare), str(b.os), str(b.cheieWindows), str(b.note)
  ];
}
function str(v) { return v == null ? "" : String(v); }

// ---- Cloudflare Access JWT verification ----
let JWKS_CACHE = { keys: null, at: 0, team: "" };
async function getJwks(team) {
  var now = Date.now();
  if (JWKS_CACHE.keys && JWKS_CACHE.team === team && (now - JWKS_CACHE.at) < 3600000) return JWKS_CACHE.keys;
  var res = await fetch("https://" + team + "/cdn-cgi/access/certs");
  if (!res.ok) return null;
  var data = await res.json();
  JWKS_CACHE = { keys: data.keys || [], at: now, team: team };
  return JWKS_CACHE.keys;
}
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function verifyAccessJwt(token, team, aud) {
  try {
    var parts = token.split(".");
    if (parts.length !== 3) return null;
    var header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    var payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    var auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (aud && auds.indexOf(aud) === -1) return null;
    var keys = await getJwks(team);
    if (!keys) return null;
    var jwk = keys.find(function (k) { return k.kid === header.kid; });
    if (!jwk) return null;
    var key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    var signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    var sig = b64urlToBytes(parts[2]);
    var ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
    if (!ok) return null;
    return payload;
  } catch (e) { return null; }
}

async function authenticate(request, env) {
  var aud = env.ACCESS_AUD, team = env.TEAM_DOMAIN;
  if (aud && team) {
    var token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return null;
    var payload = await verifyAccessJwt(token, team, aud);
    if (!payload) return null;
    return { email: String(payload.email || "").toLowerCase(), setup: false };
  }
  // MOD SETUP (Access neconfigurat): foloseste header-ul daca exista, altfel admin de dezvoltare.
  var hdr = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (hdr) return { email: hdr.toLowerCase(), setup: true };
  return { email: "", setup: true, dev: true };
}

async function resolveRole(auth, env) {
  if (auth.dev) return { kind: "admin" };
  var email = auth.email;
  var adminDomain = String(env.ADMIN_DOMAIN || "").toLowerCase();
  var adminEmails = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (email && adminDomain && email.endsWith("@" + adminDomain)) return { kind: "admin" };
  if (email && adminEmails.indexOf(email) !== -1) return { kind: "admin" };
  if (!email) return { kind: "none" };
  var rows = await env.DB.prepare("SELECT id, client_emails FROM companies").all();
  var ids = [];
  (rows.results || []).forEach(function (r) {
    var list = String(r.client_emails || "").toLowerCase().split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (list.indexOf(email) !== -1) ids.push(r.id);
  });
  if (ids.length) return { kind: "client", companyIds: ids };
  return { kind: "none" };
}

function placeholders(n) { var a = []; for (var i = 0; i < n; i++) a.push("?"); return a.join(","); }

async function handleApi(request, env, url) {
  var auth = await authenticate(request, env);
  if (!auth) return json({ error: "unauthenticated" }, 401);
  var role = await resolveRole(auth, env);
  var path = url.pathname;
  var method = request.method;

  if (path === "/api/bootstrap" && method === "GET") {
    if (role.kind === "none") return json({ error: "forbidden", email: auth.email }, 403);
    if (role.kind === "admin") {
      var cs = await env.DB.prepare("SELECT * FROM companies ORDER BY nume").all();
      var es = await env.DB.prepare("SELECT * FROM equipment").all();
      return json({
        role: "admin", email: auth.email, setup: !!auth.setup, canWrite: true,
        companies: (cs.results || []).map(function (r) { return coToApi(r, true); }),
        equipment: (es.results || []).map(eqToApi)
      });
    }
    // client
    var ph = placeholders(role.companyIds.length);
    var cc = await env.DB.prepare("SELECT * FROM companies WHERE id IN (" + ph + ") ORDER BY nume").bind(...role.companyIds).all();
    var ee = await env.DB.prepare("SELECT * FROM equipment WHERE company_id IN (" + ph + ")").bind(...role.companyIds).all();
    return json({
      role: "client", email: auth.email, setup: !!auth.setup, canWrite: false,
      companies: (cc.results || []).map(function (r) { return coToApi(r, false); }),
      equipment: (ee.results || []).map(eqToApi)
    });
  }

  // ---- toate scrierile: doar admin ----
  var isWrite = (method === "POST" || method === "PUT" || method === "DELETE");
  if (isWrite && role.kind !== "admin") return json({ error: "forbidden" }, 403);

  if (path === "/api/equipment" && (method === "POST" || method === "PUT")) {
    var b = await request.json();
    if (!b || !str(b.nume).trim()) return json({ error: "nume_required" }, 400);
    var exists = false;
    if (b.id) {
      var r0 = await env.DB.prepare("SELECT id FROM equipment WHERE id=?").bind(b.id).first();
      exists = !!r0;
    }
    if (!b.id) b.id = newId("eq_");
    var vals = apiToEqValues(b);
    var now = Date.now();
    if (exists) {
      await env.DB.prepare(
        "UPDATE equipment SET nume=?,tip=?,marca=?,serial=?,user=?,company_id=?,achizitie=?,garantie=?,status=?,procesor=?,memorie=?,stocare=?,os=?,cheie_windows=?,note=?,updated_at=? WHERE id=?"
      ).bind(vals[1],vals[2],vals[3],vals[4],vals[5],vals[6],vals[7],vals[8],vals[9],vals[10],vals[11],vals[12],vals[13],vals[14],vals[15],now,b.id).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO equipment (" + EQ_COLS.join(",") + ",updated_at) VALUES (" + placeholders(EQ_COLS.length) + ",?)"
      ).bind(vals[0],vals[1],vals[2],vals[3],vals[4],vals[5],vals[6],vals[7],vals[8],vals[9],vals[10],vals[11],vals[12],vals[13],vals[14],vals[15],now).run();
    }
    return json({ ok: true, id: b.id });
  }

  var mEq = path.match(/^\/api\/equipment\/([^\/]+)$/);
  if (mEq && method === "DELETE") {
    await env.DB.prepare("DELETE FROM equipment WHERE id=?").bind(decodeURIComponent(mEq[1])).run();
    return json({ ok: true });
  }

  if (path === "/api/company" && (method === "POST" || method === "PUT")) {
    var c = await request.json();
    if (!c || !str(c.nume).trim()) return json({ error: "nume_required" }, 400);
    var cexists = false;
    if (c.id) {
      var cr = await env.DB.prepare("SELECT id FROM companies WHERE id=?").bind(c.id).first();
      cexists = !!cr;
    }
    if (!c.id) c.id = newId("co_");
    var emails = str(c.clientEmails);
    if (cexists) {
      await env.DB.prepare("UPDATE companies SET nume=?,contact=?,cui=?,note=?,client_emails=? WHERE id=?")
        .bind(str(c.nume), str(c.contact), str(c.cui), str(c.note), emails, c.id).run();
    } else {
      await env.DB.prepare("INSERT INTO companies (id,nume,contact,cui,note,client_emails) VALUES (?,?,?,?,?,?)")
        .bind(c.id, str(c.nume), str(c.contact), str(c.cui), str(c.note), emails).run();
    }
    return json({ ok: true, id: c.id });
  }

  var mCo = path.match(/^\/api\/company\/([^\/]+)$/);
  if (mCo && method === "DELETE") {
    var cid = decodeURIComponent(mCo[1]);
    await env.DB.prepare("UPDATE equipment SET company_id='' WHERE company_id=?").bind(cid).run();
    await env.DB.prepare("DELETE FROM companies WHERE id=?").bind(cid).run();
    return json({ ok: true });
  }

  if (path === "/api/import" && method === "POST") {
    var payload = await request.json();
    var firme = Array.isArray(payload.firme) ? payload.firme : (Array.isArray(payload.companies) ? payload.companies : []);
    var echip = Array.isArray(payload.echipamente) ? payload.echipamente : (Array.isArray(payload.equipment) ? payload.equipment : []);
    var stmts = [];
    stmts.push(env.DB.prepare("DELETE FROM equipment"));
    stmts.push(env.DB.prepare("DELETE FROM companies"));
    firme.forEach(function (c) {
      var id = c.id || newId("co_");
      stmts.push(env.DB.prepare("INSERT INTO companies (id,nume,contact,cui,note,client_emails) VALUES (?,?,?,?,?,?)")
        .bind(id, str(c.nume) || "(fara nume)", str(c.contact), str(c.cui), str(c.note), str(c.clientEmails)));
    });
    echip.forEach(function (e) {
      if (!e.id) e.id = newId("eq_");
      var v = apiToEqValues(e);
      stmts.push(env.DB.prepare("INSERT INTO equipment (" + EQ_COLS.join(",") + ",updated_at) VALUES (" + placeholders(EQ_COLS.length) + ",?)")
        .bind(v[0],v[1],v[2],v[3],v[4],v[5],v[6],v[7],v[8],v[9],v[10],v[11],v[12],v[13],v[14],v[15],Date.now()));
    });
    await env.DB.batch(stmts);
    return json({ ok: true, firme: firme.length, echipamente: echip.length });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, url); }
      catch (e) { return json({ error: "server_error", detail: String(e && e.message || e) }, 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
