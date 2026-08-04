import { webcrypto } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const runtimeCrypto = globalThis.crypto || webcrypto;

function bytesToBase64(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); }
async function deriveKey(secret, usages) { const digest = await runtimeCrypto.subtle.digest("SHA-256", encoder.encode(secret)); return runtimeCrypto.subtle.importKey("raw", digest, usages.some((usage) => usage === "sign" || usage === "verify") ? { name: "HMAC", hash: "SHA-256" } : "AES-GCM", false, usages); }
export function randomToken(bytes = 24) { return bytesToBase64(runtimeCrypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export async function sha256(value) { const digest = await runtimeCrypto.subtle.digest("SHA-256", encoder.encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function hmacSign(secret, payload) { const key = await deriveKey(secret, ["sign"]); return bytesToBase64(new Uint8Array(await runtimeCrypto.subtle.sign("HMAC", key, encoder.encode(payload)))); }
export async function hmacVerify(secret, payload, signature) { try { const key = await deriveKey(secret, ["verify"]); return runtimeCrypto.subtle.verify("HMAC", key, base64ToBytes(signature), encoder.encode(payload)); } catch { return false; } }
export async function encryptStoredJson(secret, storageKey, value) { const key = await deriveKey(secret, ["encrypt"]); const iv = runtimeCrypto.getRandomValues(new Uint8Array(12)); const ciphertext = await runtimeCrypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(storageKey) }, key, encoder.encode(JSON.stringify(value))); return JSON.stringify({ v: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ciphertext)) }); }
export async function decryptStoredJson(secret, storageKey, sealed) { const record = JSON.parse(sealed); if (record.v !== 1 || !record.iv || !record.data) throw new Error("Malformed encrypted record"); const key = await deriveKey(secret, ["decrypt"]); const clear = await runtimeCrypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(record.iv), additionalData: encoder.encode(storageKey) }, key, base64ToBytes(record.data)); return JSON.parse(decoder.decode(clear)); }
export function credentialStorageKey(keyHash, tokenKey) { return `parcel:key:${keyHash}:${tokenKey}`; }
export async function saveApiKey(kv, keyHash, tokenKey, apiKey, secret) { const storageKey = credentialStorageKey(keyHash, tokenKey); await kv.put(storageKey, await encryptStoredJson(secret, storageKey, { api_key: apiKey, created_at: Date.now() })); }
export async function loadApiKey(kv, keyHash, tokenKey, secret) { const storageKey = credentialStorageKey(keyHash, tokenKey); const sealed = await kv.get(storageKey); if (!sealed) throw new Error("The stored Parcel credential is missing. Reconnect the MCP client."); return (await decryptStoredJson(secret, storageKey, sealed)).api_key; }
export async function deleteApiKeys(kv, keyHash) { const listed = await kv.list({ prefix: `parcel:key:${keyHash}:` }); await Promise.all(listed.keys.map((item) => kv.delete(item.name))); return listed.keys.length; }
export function isAllowedKeyHash(env, hash) { const allowed = (env.ALLOWED_PARCEL_KEY_HASHES || "").split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean); return allowed.length === 0 || allowed.includes(hash.toLowerCase()); }
export async function validateParcelApiKey(apiKey, fetchImpl = fetch) {
  const response = await fetchImpl("https://api.parcel.app/external/deliveries/?filter_mode=active", { headers: { Accept: "application/json", "api-key": apiKey }, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw new Error("Parcel redirected the validation request.");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) throw new Error(payload.error_message || `Parcel returned HTTP ${response.status}.`);
  return payload;
}
