# Hosted connector privacy notice

The hosted Parcel MCP connector stores the Parcel API key supplied during authorization. It encrypts that key before writing it to Cloudflare KV. The key is decrypted only to make a request to `api.parcel.app` for an authenticated MCP session.

The connector also stores OAuth grants, registered client metadata, and opaque authorization state required to connect MCP clients. It does not sell data or use tracking information for advertising.

Parcel receives the API requests required by the selected MCP tools. Cloudflare processes connector traffic and storage. Review the privacy terms of both services before connecting.

Use the connector's `/delete` page to delete an encrypted Parcel key. Removing the connector in an MCP client revokes that client grant, but it does not revoke the Parcel API key itself. Revoke the key through Parcel Web Access when necessary.
