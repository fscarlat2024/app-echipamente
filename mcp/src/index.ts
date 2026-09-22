// Conector MCP "Inventar Echipamente"
// OAuthProvider (pentru Claude) + createMcpHandler (uneltele) + Cloudflare Access ca IdP upstream.
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { buildServer } from "./mcp";
import { accessHandler } from "./access";

// apiHandler: transfera props-urile din tokenul OAuth (email) in contextul MCP,
// apoi ruleaza handler-ul MCP care serveste /mcp.
const apiHandler = {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const props = (ctx && ctx.props) || {};
    const handler = createMcpHandler(() => buildServer(env), {
      authContext: { props },
    });
    return handler(request, env, ctx);
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: apiHandler as any,
  defaultHandler: accessHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
});
