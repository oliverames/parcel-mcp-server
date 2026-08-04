import { McpAgent } from "agents/mcp";
import { createParcelServer } from "../../index.js";
import { REMOTE_SERVER_INFO } from "./brand-assets.js";
import { isAllowedKeyHash, loadApiKey } from "./parcel-credentials.js";

export class ParcelMCP extends McpAgent {
  async init() {
    const { parcelKeyHash, tokenKey, writesEnabled } = this.props;
    if (!isAllowedKeyHash(this.env, parcelKeyHash)) throw new Error("This Parcel credential is not authorized for the connector.");
    const { server } = createParcelServer({
      getApiKey: () => loadApiKey(this.env.OAUTH_KV, parcelKeyHash, tokenKey, this.env.DATA_ENCRYPTION_KEY),
      hasCredentials: true,
      writesEnabled: !!writesEnabled,
      runtime: { keySource: { source_label: "encrypted Parcel API key (hosted connector)" }, detected_agent: "remote", config_fallback_disabled: true, sources_checked: [], lookup_errors: [] },
      serverInfo: REMOTE_SERVER_INFO,
    });
    this.server = server;
  }
}
