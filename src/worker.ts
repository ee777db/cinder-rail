import {DurableObject} from 'cloudflare:workers';
import {canonical,encoder,base64url,unbase64url,sha256,SERVICES,UNIT,validPublicKey,selectInput} from './protocol';
interface Env {
  SESSIONS: DurableObjectNamespace<ComputeSession>;
  CONTROL: DurableObjectNamespace<ControlPlane>;
  ASSETS: Fetcher;
  AI: Ai;
  INFERENCE_ENABLED: string;
  MAX_INFERENCES_PER_DAY: string;
  MAX_SESSIONS_PER_DAY: string;
  MAX_CALLS_PER_DAY: string;
}
const json = (value: any, status = 200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const fail = (status: number, error: string, message: string) => json({error,message},status);
const idPattern = /^[a-f0-9]{64}$/;
const MAX_BODY = 16000;
async function readBody(request: Request): Promise<any> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('Use application/json.');
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new Error('Request too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body required.');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {const {value,done} = await reader.read(); if(done) break; size += value.byteLength; if(size > MAX_BODY){await reader.cancel();throw new Error('Request too large.');} chunks.push(value);}
  const buf = new Uint8Array(size);let at=0;for(const chunk of chunks){buf.set(chunk,at);at+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(buf));
}
function control(env: Env, path: string, body?: any) {
  return env.CONTROL.get(env.CONTROL.idFromName('cinder-provider-v1')).fetch('https://internal'+path, body === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
}
async function gate(env: Env, action: string, ip: string): Promise<Response|null> {
  const response = await control(env,'/gate',{action,ip});
  return response.ok ? null : response;
}
function secure(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('X-Frame-Options','DENY');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  if(new URL(request.url).pathname.startsWith('/api/')) headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
}
export default {
  async fetch(request: Request,env: Env): Promise<Response> {
    let response: Response;
    try {response = await route(request,env);} catch {response = fail(400,'invalid_request','Invalid request. Check the JSON body, input length and signature format.');}
    return secure(response,request);
  }
};
async function route(request: Request,env: Env): Promise<Response> {
  const url = new URL(request.url); const path=url.pathname;
  if(request.method === 'OPTIONS') return new Response(null,{status:204,headers:{Allow:'GET, POST, OPTIONS'}});
  if(request.method === 'POST') {
    const origin=request.headers.get('origin');
    if(origin && origin!==url.origin) return fail(403,'origin_rejected','Requests from another website are not accepted.');
  }
  if(path==='/api/health' && request.method==='GET') return json({status:'ok',name:'Cinder Rail',version:'0.1.0',mode:'sandbox',settlement:'nonredeemable-test-ledger',verification:'signed-receipt',inferenceEnabled:env.INFERENCE_ENABLED==='true',chainDeployed:false});
  if(path==='/api/catalog' && request.method==='GET') return json({services:SERVICES.map(x=>({...x,available:x.id!=='inference'||env.INFERENCE_ENABLED==='true'})),unit:UNIT,initialBalanceMicros:10000,notice:'Test credits have no monetary value. Signed receipts prove issuer provenance, not inference correctness.'});
  if(path==='/api/key' && request.method==='GET') return control(env,'/key');
  const ip=request.headers.get('CF-Connecting-IP') || 'local-development';
  if(path==='/api/sessions' && request.method==='POST') {
    const body=await readBody(request);
    if(!validPublicKey(body.publicKey)) return fail(400,'invalid_key','Provide a public P-256 JWK without private key material.');
    try {await crypto.subtle.importKey('jwk',body.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);} catch {return fail(400,'invalid_key','The public key is not a valid P-256 key.');}
    const limited=await gate(env,'session',ip);if(limited)return limited;
    const sessionToken=base64url(crypto.getRandomValues(new Uint8Array(32)));
    const sessionId=base64url(crypto.getRandomValues(new Uint8Array(32)));
    const internalId=await sha256(sessionId);
    const stub=env.SESSIONS.get(env.SESSIONS.idFromName(internalId));
    return stub.fetch('https://internal/init',{method:'POST',body:JSON.stringify({sessionId:internalId,sessionToken,publicKey:{kty:'EC',crv:'P-256',x:body.publicKey.x,y:body.publicKey.y,ext:true}})});
  }
  const sessionMatch=path.match(/^\/api\/sessions\/([a-f0-9]{64})$/);
  if(sessionMatch && request.method==='GET') {const limited=await gate(env,'request',ip);if(limited)return limited;return env.SESSIONS.get(env.SESSIONS.idFromName(sessionMatch[1])).fetch('https://internal/state',{headers:{'x-cinder-session':request.headers.get('x-cinder-session')||''}});}
  if(path==='/api/execute' && request.method==='POST') {
    const body=await readBody(request);
    if(!idPattern.test(body.sessionId||'')) return fail(400,'invalid_session','Create an agent session first.');
    const limited=await gate(env,'request',ip);if(limited)return limited;
    return env.SESSIONS.get(env.SESSIONS.idFromName(body.sessionId)).fetch('https://internal/execute',{method:'POST',headers:{'x-cinder-session':request.headers.get('x-cinder-session')||''},body:JSON.stringify(body)});
  }
  if(path.startsWith('/api/')) return fail(404,'not_found','Unknown API route or method.');
  if(!['GET','HEAD'].includes(request.method)) return fail(405,'method_not_allowed','Use GET to read this page.');
  const pages: Record<string,string>={'/protocol':'/index.html','/developers':'/index.html','/launch':'/index.html','/security':'/security.html','/privacy':'/privacy.html'};
  if(pages[path]) url.pathname=pages[path];
  return env.ASSETS.fetch(new Request(url.toString(),request));
}
interface Ledger {sessionId:string;tokenHash:string;publicKey:JsonWebKey;balanceMicros:number;spentMicros:number;createdAt:string;expiresAt:string;pending:string|null;pendingAt?:number;quoteCount:number;receipts:any[];}
export class ComputeSession extends DurableObject<Env> {
  async recover() {
    const ledger = await this.ctx.storage.get<Ledger>('ledger');
    if (!ledger) return;
    if (Date.parse(ledger.expiresAt) <= Date.now()) {await this.ctx.storage.deleteAll(); return;}
    if (ledger.pending && ledger.pendingAt && Date.now() - ledger.pendingAt >= 120000) {
      const saved = await this.ctx.storage.get<any>('quote:' + ledger.pending);
      if (saved?.status === 'pending') {
        ledger.balanceMicros += saved.quote.amountMicros; ledger.spentMicros -= saved.quote.amountMicros;
        await this.ctx.storage.put('quote:' + ledger.pending, {...saved, status:'failed'});
      }
      ledger.pending = null; delete ledger.pendingAt; await this.ctx.storage.put('ledger', ledger);
    }
    await this.ctx.storage.setAlarm(ledger.pending && ledger.pendingAt ? Math.min(ledger.pendingAt + 120000, Date.parse(ledger.expiresAt)) : Date.parse(ledger.expiresAt));
  }
  async alarm(){await this.ctx.blockConcurrencyWhile(() => this.recover());}
  async fetch(request:Request):Promise<Response> {
    const path=new URL(request.url).pathname;
    await this.ctx.blockConcurrencyWhile(() => this.recover());
    if(path==='/init') return this.ctx.blockConcurrencyWhile(async()=>{
      if(await this.ctx.storage.get('ledger'))return fail(409,'already_exists','Session exists.');
      const body:any=await request.json();const expiresAt=new Date(Date.now()+24*60*60*1000).toISOString();
      const ledger:Ledger={sessionId:body.sessionId,tokenHash:await sha256(body.sessionToken),publicKey:body.publicKey,balanceMicros:10000,spentMicros:0,createdAt:new Date().toISOString(),expiresAt,pending:null,quoteCount:0,receipts:[]};
      await this.ctx.storage.put('ledger',ledger);await this.ctx.storage.setAlarm(Date.parse(expiresAt));
      return json({sessionId:ledger.sessionId,sessionToken:body.sessionToken,balanceMicros:ledger.balanceMicros,expiresAt,unit:UNIT},201);
    });
    if(path==='/state') {
      const ledger=await this.ctx.storage.get<Ledger>('ledger');
      if(!ledger || Date.parse(ledger.expiresAt)<=Date.now())return fail(404,'session_expired','This session is missing or expired. Create a new one.');
      if(await sha256(request.headers.get('x-cinder-session')||'')!==ledger.tokenHash)return fail(401,'session_auth_required','A private session token is required.');
      return json({sessionId:ledger.sessionId,balanceMicros:ledger.balanceMicros,spentMicros:ledger.spentMicros,expiresAt:ledger.expiresAt,pending:!!ledger.pending,receipts:ledger.receipts,unit:UNIT});
    }
    if(path!=='/execute')return fail(404,'not_found','Unknown operation.');
    const body:any=await request.json();
    let reservation:any;
    const early=await this.ctx.blockConcurrencyWhile(async():Promise<Response|null>=>{
      const ledger=await this.ctx.storage.get<Ledger>('ledger');
      if(!ledger||Date.parse(ledger.expiresAt)<=Date.now())return fail(404,'session_expired','This session expired. Create a new one.');
      if(!body.quoteId){
        if(await sha256(request.headers.get('x-cinder-session')||'')!==ledger.tokenHash)return fail(401,'session_auth_required','A private session token is required to create quotes.');
        if(ledger.pending)return fail(409,'in_progress','A compute request is still running.');
        let selected,input;try {({selected,input}=selectInput(body.service,body.input));}catch{return fail(400,'invalid_input','Choose a service and provide text within its input limit.');}
        if(selected.id==='inference'&&this.env.INFERENCE_ENABLED!=='true')return fail(503,'inference_unavailable','Inference is disabled. Deterministic hashing remains available.');
        if(ledger.quoteCount>=100)return fail(429,'session_limit','This session reached its 100-quote limit.');
        if(ledger.balanceMicros<selected.amountMicros)return fail(402,'insufficient_credits','This session has insufficient test credits.');
        const quote={id:crypto.randomUUID(),sessionId:ledger.sessionId,service:selected.id,inputHash:await sha256(input),amountMicros:selected.amountMicros,cumulativeMicros:ledger.spentMicros+selected.amountMicros,nonce:crypto.randomUUID(),issuedAt:new Date().toISOString(),expiresAt:new Date(Math.min(Date.now()+120000,Date.parse(ledger.expiresAt))).toISOString()};
        ledger.quoteCount++;
        await this.ctx.storage.put({'ledger':ledger,['quote:'+quote.id]:{quote,status:'quoted'}});
        return json({error:'payment_required',protocol:'cinder-sandbox-v1',unit:UNIT,quote,signingPayload:canonical(quote),message:'Sign this exact quote with your session key to authorize test credits. This is a custom HTTP 402 sandbox, not an x402 payment.'},402);
      }
      if(typeof body.quoteId!=='string'||body.quoteId.length>64)return fail(400,'invalid_quote','Invalid quote identifier.');
      const saved=await this.ctx.storage.get<any>('quote:'+body.quoteId);
      if(!saved)return fail(404,'quote_missing','Request a quote first.');
      const quote=saved.quote;
      if(typeof body.input!=='string'||body.input.length>4000||await sha256(body.input)!==quote.inputHash)return fail(400,'input_mismatch','Input does not match the signed quote.');
      let signatureValid=false;
      try {const key=await crypto.subtle.importKey('jwk',ledger.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);signatureValid=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unbase64url(body.signature),encoder.encode(canonical(quote)));}catch{}
      if(!signatureValid)return fail(401,'invalid_signature','The quote signature does not match this agent.');
      if(saved.status==='complete')return json({...saved.result,balanceMicros:ledger.balanceMicros,replayed:true});
      if(saved.status==='failed')return fail(409,'quote_failed','This quote failed and was refunded. Request a new quote.');
      if(saved.status==='pending'||ledger.pending)return fail(409,'in_progress','A request is in progress; retry this signed request to retrieve its result.');
      if(Date.parse(quote.expiresAt)<=Date.now())return fail(410,'quote_expired','This quote expired. Request a new quote.');
      if(quote.cumulativeMicros!==ledger.spentMicros+quote.amountMicros)return fail(409,'stale_quote','The session balance changed. Request a fresh quote.');
      if(quote.amountMicros>ledger.balanceMicros)return fail(402,'insufficient_credits','Insufficient test credits.');
      const limited=await gate(this.env,quote.service==='inference'?'inference':'compute',ledger.sessionId);if(limited)return limited;
      ledger.balanceMicros-=quote.amountMicros;ledger.spentMicros+=quote.amountMicros;ledger.pending=quote.id;ledger.pendingAt=Date.now();
      await this.ctx.storage.put({'ledger':ledger,['quote:'+quote.id]:{...saved,status:'pending'}});
      await this.ctx.storage.setAlarm(Math.min(Date.now()+120000,Date.parse(ledger.expiresAt)));
      reservation={quote,input:body.input};return null;
    });
    if(early)return early;
    const {quote,input}=reservation;
    try {
      const started=Date.now();let output:string;let usage:any;
      if(quote.service==='hash'){output=await sha256(input);usage={inputBytes:encoder.encode(input).length};}
      else {
        const response:any=await this.env.AI.run(SERVICES[1].model as any,{messages:[{role:'system',content:'You are a concise assistant. Answer the user clearly in at most 120 words.'},{role:'user',content:input}],max_tokens:192,temperature:0.2});
        if(typeof response?.response!=='string'||!response.response.trim())throw new Error('Provider returned no output');
        output=response.response;usage={maxOutputTokens:192,...(response.usage?{providerReported:response.usage}:{})};
      }
      const keyInfo:any=await (await control(this.env,'/key')).json();
      const receipt={id:crypto.randomUUID(),sessionId:quote.sessionId,quoteId:quote.id,service:quote.service,model:SERVICES.find(x=>x.id===quote.service)!.model,inputHash:quote.inputHash,outputHash:await sha256(output),amountMicros:quote.amountMicros,cumulativeMicros:quote.cumulativeMicros,issuedAt:new Date().toISOString(),keyId:keyInfo.keyId,verification:'signed-receipt',mode:'sandbox',unit:UNIT,durationMs:Date.now()-started,usage};
      const signedResponse=await control(this.env,'/sign',{receipt});if(!signedResponse.ok)throw new Error('Signing unavailable');
      const signed:any=await signedResponse.json();
      return await this.ctx.blockConcurrencyWhile(async()=>{
        const ledger=(await this.ctx.storage.get<Ledger>('ledger'))!;
        if(!ledger||ledger.pending!==quote.id)return fail(409,'reservation_expired','This request outlived its reservation. Its result was discarded and test credits were released.');
        const result={receipt,signature:signed.signature,signingPayload:canonical(receipt),output,balanceMicros:ledger.balanceMicros};
        ledger.pending=null;delete ledger.pendingAt;ledger.receipts.unshift(result);ledger.receipts=ledger.receipts.slice(0,50);
        await this.ctx.storage.put({'ledger':ledger,['quote:'+quote.id]:{quote,status:'complete',result}});
        return json(result);
      });
    } catch {
      return await this.ctx.blockConcurrencyWhile(async()=>{
        const ledger=await this.ctx.storage.get<Ledger>('ledger');
        if(ledger && ledger.pending===quote.id){ledger.balanceMicros+=quote.amountMicros;ledger.spentMicros-=quote.amountMicros;ledger.pending=null;await this.ctx.storage.put({'ledger':ledger,['quote:'+quote.id]:{quote,status:'failed'}});}
        return fail(503,'compute_unavailable','The compute provider could not complete this request. Reserved test credits were refunded. Request a new quote to retry.');
      });
    }
  }
}
export class ControlPlane extends DurableObject<Env> {
  async keypair():Promise<{privateKey:JsonWebKey;publicKey:JsonWebKey;keyId:string}> {
    let pair=await this.ctx.storage.get<any>('issuer');
    if(!pair){const generated=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']) as CryptoKeyPair;const publicKey=await crypto.subtle.exportKey('jwk',generated.publicKey);pair={privateKey:await crypto.subtle.exportKey('jwk',generated.privateKey),publicKey,keyId:'cinder-p256-'+(await sha256(canonical(publicKey))).slice(0,16)};await this.ctx.storage.put('issuer',pair);}
    return pair;
  }
  async fetch(request:Request):Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async()=>{
      const path=new URL(request.url).pathname;
      if(path==='/key'){const {publicKey,keyId}=await this.keypair();return json({publicKey,keyId,algorithm:'ECDSA-P256-SHA256',trust:'Operator-issued key. Pin this key for independent verification.'});}
      if(path==='/sign'){const {receipt}:any=await request.json();const pair=await this.keypair();const key=await crypto.subtle.importKey('jwk',pair.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);return json({signature:base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(canonical(receipt))))});}
      if(path==='/gate'){
        const {action,ip}:any=await request.json();const day=new Date().toISOString().slice(0,10);
        let quota=await this.ctx.storage.get<any>('quota');
        if(!quota||quota.day!==day)quota={day,salt:crypto.randomUUID(),sessions:0,requests:0,computes:0,inferences:0,ips:{}};
        if(action==='session'){
          const ipHash=await sha256(quota.salt+ip);const count=quota.ips[ipHash]||0;
          if(quota.sessions>=Number(this.env.MAX_SESSIONS_PER_DAY)||count>=10)return fail(429,'session_limit','Daily sandbox session limit reached. Try again after 00:00 UTC.');
          quota.sessions++;quota.ips[ipHash]=count+1;
        }else if(action==='request'){
          quota.requestIPs ||= {}; const ipHash=await sha256(quota.salt+ip);const count=quota.requestIPs[ipHash]||0;
          if(count>=600 || (!count && Object.keys(quota.requestIPs).length>=2048))return fail(429,'client_request_limit','Daily request allowance reached. Try again after 00:00 UTC.');
          if(quota.requests>=Number(this.env.MAX_CALLS_PER_DAY)*4)return fail(429,'request_limit','Daily sandbox request limit reached. Try again after 00:00 UTC.');quota.requests++;quota.requestIPs[ipHash]=count+1;
        }else{
          if(quota.computes>=Number(this.env.MAX_CALLS_PER_DAY))return fail(429,'compute_limit','Daily compute limit reached. Try again after 00:00 UTC.');
          if(action==='inference') {if(quota.inferences>=Number(this.env.MAX_INFERENCES_PER_DAY))return fail(429,'inference_limit','Daily inference limit reached. Hashing remains available.');quota.inferences++;}
          quota.computes++;
        }
        await this.ctx.storage.put('quota',quota);return json({allowed:true});
      }
      return fail(404,'not_found','Unknown control operation.');
    });
  }
}
