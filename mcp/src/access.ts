// Handler de login: deleaga autentificarea catre Cloudflare Access (OIDC upstream).
// Access aplica politica @netcomm.ro; noi primim email-ul in id_token si il punem in props.

function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  // atob e disponibil in Workers
  const bin = atob(s);
  try {
    // decodeaza corect UTF-8
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return bin;
  }
}

function parseJwt(token: string): any {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(b64urlDecode(payload));
  } catch {
    return {};
  }
}

export const accessHandler = {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // 1) Claude ne cere autorizarea -> redirectam la Cloudflare Access
    if (url.pathname === "/authorize") {
      let oauthReq: any;
      try {
        oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch (e: any) {
        return new Response("Cerere de autorizare invalida: " + (e?.message || e), { status: 400 });
      }
      // validare client (DCR) - daca nu exista, provider-ul l-a inregistrat deja prin /register
      try { await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId); } catch {}

      const state = crypto.randomUUID();
      await env.OAUTH_KV.put("auth:" + state, JSON.stringify(oauthReq), { expirationTtl: 600 });

      const authUrl = new URL(env.ACCESS_AUTH_URL);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", env.ACCESS_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", url.origin + "/callback");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("state", state);
      return Response.redirect(authUrl.toString(), 302);
    }

    // 2) Access ne trimite inapoi cu un cod -> schimbam pe token, luam email-ul, finalizam grantul
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") || "";
      const err = url.searchParams.get("error");
      if (err) return new Response("Access a refuzat autentificarea: " + err, { status: 403 });
      if (!code) return new Response("Lipseste codul de autorizare.", { status: 400 });

      const storedRaw = await env.OAUTH_KV.get("auth:" + state);
      if (!storedRaw) return new Response("Sesiune expirata sau state invalid. Reincearca.", { status: 400 });
      const oauthReq = JSON.parse(storedRaw);
      await env.OAUTH_KV.delete("auth:" + state);

      let tok: any;
      try {
        const res = await fetch(env.ACCESS_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            client_id: env.ACCESS_CLIENT_ID,
            client_secret: env.ACCESS_CLIENT_SECRET,
            redirect_uri: url.origin + "/callback",
          }),
        });
        tok = await res.json();
      } catch (e: any) {
        return new Response("Eroare la schimbul de token: " + (e?.message || e), { status: 502 });
      }
      if (!tok || (!tok.id_token && !tok.access_token)) {
        return new Response("Raspuns token invalid de la Access.", { status: 502 });
      }

      const claims = parseJwt(tok.id_token || tok.access_token);
      const email = String(claims.email || claims.upn || "").toLowerCase();
      const name = String(claims.name || claims.given_name || email || "utilizator");
      if (!email) return new Response("Nu am putut determina email-ul din Access.", { status: 403 });

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: email,
        metadata: { email },
        scope: oauthReq.scope,
        props: { email, name },
      });
      return Response.redirect(redirectTo, 302);
    }

    // pagina simpla la radacina
    if (url.pathname === "/") {
      return new Response(
        "Conector MCP Inventar Echipamente (NCS). Endpoint MCP: /mcp",
        { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
