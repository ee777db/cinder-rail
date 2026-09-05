export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const encoder = new TextEncoder();
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function unbase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 256) throw new Error('Invalid signature encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function sha256(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const SERVICES = [
  {id:'hash',name:'SHA-256 digest',description:'Deterministic text hashing. Recompute the result independently.',amountMicros:10,maxInputChars:4000,model:'sha256-v1'},
  {id:'inference',name:'Llama inference',description:'One short response from Meta Llama on Cloudflare Workers AI.',amountMicros:500,maxInputChars:1200,model:'@cf/meta/llama-3.1-8b-instruct-fp8-fast'}
];
export const UNIT = 'sandbox-microUSD';
export function validPublicKey(key: any): boolean {
  return !!key && key.kty === 'EC' && key.crv === 'P-256' && typeof key.x === 'string' && typeof key.y === 'string' && !key.d;
}
export function selectInput(service: unknown, input: unknown) {
  const selected = SERVICES.find(x => x.id === service);
  if (!selected || typeof input !== 'string' || input.trim().length === 0 || input.length > selected.maxInputChars) throw new Error('Choose a valid service and provide text within its input limit.');
  return {selected,input};
}
