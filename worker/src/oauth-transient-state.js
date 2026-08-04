const TTL = 10 * 60 * 1000;
export class OAuthTransientState {
  constructor(state) { this.storage = state.storage; }
  async fetch(request) {
    const key = new URL(request.url).pathname;
    if (request.method === "PUT") { await this.storage.put(key, { value: await request.json(), expires_at: Date.now() + TTL }); return new Response(null, { status: 204 }); }
    if (request.method === "DELETE") { const stored = await this.storage.get(key); await this.storage.delete(key); if (!stored || stored.expires_at < Date.now()) return Response.json({ error: "expired_or_missing" }, { status: 404 }); return Response.json(stored.value); }
    return new Response("Method not allowed", { status: 405 });
  }
}
