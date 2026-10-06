import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {nativeGenerateKey,nativeSign,nativeHash,nativeBase64url} from '../src/native-crypto.ts';
import {bytesHash} from '../src/native-media.ts';
let source=(await readFile(new URL('../src/native-ledger.ts',import.meta.url),'utf8')).replace("import {DurableObject} from 'cloudflare:workers';",'class DurableObject { ctx:any;env:any;constructor(ctx:any,env:any){this.ctx=ctx;this.env=env;} }');
source=source.replace(/from '(\.\/native-[a-z-]+)(?:\.ts)?'/g,(_,p)=>`from '${new URL('../src/'+p.slice(2)+'.ts',import.meta.url).href}'`);
const {NativeLedger}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
class Storage{
 values=new Map();alarm=null;failKey=null;
 async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.values.has(x)).map(x=>[x,structuredClone(this.values.get(x))])):structuredClone(this.values.get(k));}
 async put(k,v){const pairs=typeof k==='string'?[[k,v]]:Object.entries(k);if(this.failKey&&pairs.some(([name])=>name.startsWith(this.failKey))){this.failKey=null;throw new Error('Injected batch failure');}for(const [name,val]of pairs)this.values.set(name,structuredClone(val));}
 async setAlarm(t){this.alarm=t;}async deleteAlarm(){this.alarm=null;}
 async list(opts){return new Map([...this.values].filter(([k])=>k.startsWith(opts.prefix)&&(!opts.startAfter||k>opts.startAfter)&&(!opts.end||k<opts.end)).sort(([a],[b])=>a.localeCompare(b)).slice(0,opts.limit||1000).map(([k,v])=>[k,structuredClone(v)]));}
}
function harness(){const storage=new Storage();let tail=Promise.resolve();return {storage,ledger:new NativeLedger({storage,blockConcurrencyWhile(fn){const task=tail.then(fn);tail=task.catch(()=>{});return task;},waitUntil(){}},{AI:{run:async()=>({response:'fixture output'})}})};}
async function request(h,path,body){const r=await h.ledger.fetch(new Request('https://test.invalid/api/native/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}
async function wallet(h){const key=nativeGenerateKey(),authorization={domain:'cinder.account.v1',chainId:'cinder-devnet-1',publicKey:key.publicKey};assert.equal((await request(h,'accounts',{publicKey:key.publicKey,proof:nativeSign(authorization,key.secretKey)})).status,201);return key;}
async function submit(h,key,action,cap){const account=(await request(h,'accounts/'+key.address)).body;const transaction={domain:'cinder.transaction.v1',chainId:'cinder-devnet-1',sender:key.address,nonce:account.nonce+1,validUntil:new Date(Date.now()+120000).toISOString(),maxDebitAtoms:cap,actions:[action]};return request(h,'submit',{transaction,signature:nativeSign(transaction,key.secretKey)});}
const funded=async h=>{const key=await wallet(h);assert.equal((await submit(h,key,{type:'faucet'},'0')).status,200);return key;};
test('public payment replay cannot disclose a private music access token',async()=>{
 const h=harness(),owner=await funded(h),payer=await funded(h),attacker=await wallet(h),bytes=new Uint8Array(44);bytes.set(new TextEncoder().encode('RIFF'));bytes.set(new TextEncoder().encode('WAVE'),8);const hash=bytesHash(bytes),authorization={domain:'cinder.media-chunk.v1',chainId:'cinder-devnet-1',owner:owner.address,uploadId:'a'.repeat(32),audioHash:hash,mime:'audio/wav',bytes:44,chunks:1,index:0,chunkHash:hash,validUntil:new Date(Date.now()+60000).toISOString()};
 assert.equal((await request(h,'media/upload',{authorization,signature:nativeSign(authorization,owner.secretKey),data:nativeBase64url(bytes)})).status,200);
 const publication=await submit(h,owner,{type:'music.publish',audioHash:hash,title:'Fixture',artist:'Test',mime:'audio/wav',bytes:44,recipients:[{address:owner.address,bps:10000}],priceAtoms:'100',rightsDeclared:true},'12');assert.equal(publication.status,200);
 const paid=await submit(h,payer,{type:'music.listen',trackId:publication.body.receipt.result.trackId,listenId:'b'.repeat(32)},'112');assert.equal(paid.status,200);assert.equal(paid.body.playbackToken,undefined);
 const receipt=(await request(h,'transactions/'+paid.body.txHash)).body.receipt;const replay=await request(h,'submit',{transaction:receipt.transaction,signature:receipt.signature});assert.equal(replay.status,200);assert.equal(replay.body.playbackToken,undefined);
 const proof=key=>{const authorization={domain:'cinder.music.playback.v1',chainId:'cinder-devnet-1',owner:key.address,transactionHash:paid.body.txHash,nonce:'c'.repeat(32),validUntil:new Date(Date.now()+60000).toISOString()};return {authorization,signature:nativeSign(authorization,key.secretKey)};};
 assert.equal((await request(h,'music/access',proof(attacker))).status,403);assert.equal((await request(h,'music/access',{authorization:receipt.transaction,signature:receipt.signature})).status,400);
 const access=await request(h,'music/access',proof(payer));assert.equal(access.status,200);assert.equal(access.body.playbackToken.length,43);assert.ok(!JSON.stringify((await request(h,'export')).body).includes(access.body.playbackToken));
});
test('channel call persistence is atomic, exact replay safe, and settlement moves only earned value',async()=>{
 const h=harness(),owner=await funded(h),session=nativeGenerateKey();const opened=await submit(h,owner,{type:'channel.open',sessionPublicKey:session.publicKey,capacity:10,service:'hash',expiresAt:new Date(Date.now()+60000).toISOString()},'1012');assert.equal(opened.status,200);const channel=opened.body.receipt.result.channel,input='Bounded work',message={domain:'cinder.channel-call.v1',chainId:'cinder-devnet-1',channelId:channel.channelId,sequence:1,inputHash:nativeHash(input)},body={message,signature:nativeSign(message,session.secretKey),input};
 h.storage.failKey='channel:journal:';assert.equal((await request(h,'channels/call',body)).status,400);assert.equal((await h.storage.get('channel:'+channel.channelId)).sequence,0);
 assert.equal((await request(h,'channels/call',body)).status,200);assert.equal((await h.storage.get('account:'+channel.escrow)).balanceAtoms,'1000');assert.equal((await h.storage.get('account:system:provider')).balanceAtoms,'0');assert.equal((await request(h,'channels/call',body)).body.replayed,true);
 const changed={...message,inputHash:nativeHash('Other')};assert.equal((await request(h,'channels/call',{message:changed,signature:nativeSign(changed,session.secretKey),input:'Other'})).status,409);
 const close=await submit(h,owner,{type:'channel.close',channelId:channel.channelId},'12');assert.equal(close.status,200);assert.equal(close.body.receipt.result.settledAtoms,'100');assert.equal(close.body.receipt.result.refundedAtoms,'900');assert.equal((await h.storage.get('account:'+channel.escrow)).balanceAtoms,'0');assert.equal((await request(h,'channels/call',body)).status,200);assert.equal((await submit(h,owner,{type:'channel.close',channelId:channel.channelId},'12')).status,409);
});
test('alarm closes expired channel once without owner participation or a liquid fee balance',async()=>{
 const h=harness(),owner=await funded(h),session=nativeGenerateKey(),expiresAt=new Date(Date.now()+5000).toISOString(),opened=await submit(h,owner,{type:'channel.open',sessionPublicKey:session.publicKey,capacity:2,service:'hash',expiresAt},'212');assert.equal(opened.status,200);const channel=opened.body.receipt.result.channel,input='Recover',message={domain:'cinder.channel-call.v1',chainId:'cinder-devnet-1',channelId:channel.channelId,sequence:1,inputHash:nativeHash(input)};assert.equal((await request(h,'channels/call',{message,signature:nativeSign(message,session.secretKey),input})).status,200);
 const clock=Date.now;Date.now=()=>Date.parse(expiresAt);try{await h.ledger.alarm();}finally{Date.now=clock;}
 assert.equal((await h.storage.get('channel:'+channel.channelId)).closeReason,'expired');assert.equal((await h.storage.get('account:'+channel.escrow)).balanceAtoms,'0');assert.equal((await h.storage.get('account:system:provider')).balanceAtoms,'100');assert.equal(h.storage.alarm,null);const height=(await h.storage.get('meta')).height;await h.ledger.alarm();assert.equal((await h.storage.get('meta')).height,height);
});

test('commit-time market and channel deadlines reject without changing balances, nonce or history',async t=>{
 for(const kind of ['economy.addLiquidity','economy.removeLiquidity','economy.swap','channel.open'])await t.test(kind,async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()});
  const h=harness(),owner=await funded(h);
  if(kind.startsWith('economy.')){
   assert.equal((await submit(h,owner,{type:'economy.buy',workUnits:'20',maxCinderAtoms:'2000'},'2012')).status,200);
   if(kind!=='economy.addLiquidity')assert.equal((await submit(h,owner,{type:'economy.addLiquidity',maxCinderAtoms:'1000',maxWorkUnits:'10',minLpUnits:'1',deadline:new Date(Date.now()+60000).toISOString()},'1012')).status,200);
  }
  const deadline=new Date(Date.now()+1000).toISOString();
  const action=kind==='economy.addLiquidity'?{type:kind,maxCinderAtoms:'1000',maxWorkUnits:'10',minLpUnits:'1',deadline}
   :kind==='economy.removeLiquidity'?{type:kind,lpUnits:'10',minCinderAtoms:'1',minWorkUnits:'1',deadline}
   :kind==='economy.swap'?{type:kind,assetIn:'CINDER',amountIn:'200',minOut:'1',deadline}
   :{type:kind,sessionPublicKey:nativeGenerateKey().publicKey,capacity:2,service:'hash',expiresAt:deadline};
  const account=await h.storage.get('account:'+owner.address);
  const transaction={domain:'cinder.transaction.v1',chainId:'cinder-devnet-1',sender:owner.address,nonce:account.nonce+1,validUntil:new Date(Date.now()+60000).toISOString(),maxDebitAtoms:'1012',actions:[action]};
  const payload={transaction,signature:nativeSign(transaction,owner.secretKey)};
  const durableState=()=>new Map([...h.storage.values].filter(([key])=>key!=='quota').map(([key,value])=>[key,structuredClone(value)]));
  const before=durableState(),get=h.storage.get.bind(h.storage);let metaReads=0,deadlineCrossings=0;
  // initialize() reads meta first. append() reads it again after applying the
  // transition; simulate that awaited read returning at the exact expiry.
  h.storage.get=async key=>{if(key==='meta'&&++metaReads===2){t.mock.timers.tick(1000);deadlineCrossings++;}return get(key);};
  const response=await request(h,'submit',payload);
  assert.equal(deadlineCrossings,1,'The deadline must cross after transition validation');
  assert.equal(response.status,410);
  assert.equal(response.body.error,kind==='channel.open'?'invalid_channel_expiry':'economy_expired');
  assert.deepEqual(durableState(),before,'Rejection must preserve every monetary, resource, nonce and history row');
 });
});

const durableRows=h=>new Map([...h.storage.values].filter(([key])=>key!=='quota').map(([key,value])=>[key,structuredClone(value)]));
const callEnvelope=(session,channelId,sequence)=>{const input='storage budget call '+sequence,message={domain:'cinder.channel-call.v1',chainId:'cinder-devnet-1',channelId,sequence,inputHash:nativeHash(input)};return {message,signature:nativeSign(message,session.secretKey),input};};
async function openBudgetChannel(h,owner,session,capacity,expiresAt=new Date(Date.now()+60000).toISOString()){
 return submit(h,owner,{type:'channel.open',sessionPublicKey:session.publicKey,capacity,service:'hash',expiresAt},(BigInt(capacity)*100n+12n).toString());
}
test('lifetime call budget reserves atomically, releases unused capacity and preserves replay at exhaustion',async()=>{
 const h=harness(),owner=await funded(h),session=nativeGenerateKey();
 // Represent earlier accepted history without executing another 99,995 calls.
 await h.storage.put('channelUsage',{version:1,acceptedCalls:99995,reservedCalls:0});
 const opened=await openBudgetChannel(h,owner,session,3);assert.equal(opened.status,200);const id=opened.body.receipt.result.channelId;
 assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:99995,reservedCalls:3});
 let before=durableRows(h);assert.equal((await openBudgetChannel(h,owner,session,3)).body.error,'channel_lifetime_limit');assert.deepEqual(durableRows(h),before);
 h.storage.failKey='channel:';assert.equal((await openBudgetChannel(h,owner,session,2)).status,400);assert.deepEqual(durableRows(h),before,'Failed open must not reserve storage or funds');
 const body=callEnvelope(session,id,1);h.storage.failKey='channel:journal:';
 assert.equal((await request(h,'channels/call',body)).status,400);assert.deepEqual(durableRows(h),before,'Failed journal write must not consume a reservation');
 assert.equal((await request(h,'channels/call',body)).status,200);
 assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:99996,reservedCalls:2});
 before=durableRows(h);h.storage.failKey='transaction:';
 assert.equal((await submit(h,owner,{type:'channel.close',channelId:id},'12')).status,400);assert.deepEqual(durableRows(h),before,'Failed close must retain its unused budget reservation');
 assert.equal((await submit(h,owner,{type:'channel.close',channelId:id},'12')).status,200);
 assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:99996,reservedCalls:0});
 const last=await openBudgetChannel(h,owner,session,4);assert.equal(last.status,200);const lastId=last.body.receipt.result.channelId;
 before=durableRows(h);assert.equal((await openBudgetChannel(h,owner,session,1)).body.error,'channel_lifetime_limit');assert.deepEqual(durableRows(h),before);
 let lastCall;for(let sequence=1;sequence<=4;sequence++){lastCall=callEnvelope(session,lastId,sequence);assert.equal((await request(h,'channels/call',lastCall)).status,200);}
 assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:100000,reservedCalls:0});
 before=durableRows(h);assert.equal((await request(h,'channels/call',lastCall)).body.replayed,true);assert.deepEqual(durableRows(h),before,'Exact replay must work without consuming storage budget');
 assert.equal((await openBudgetChannel(h,owner,session,1)).body.error,'channel_lifetime_limit');assert.deepEqual(durableRows(h),before);
 assert.equal((await submit(h,owner,{type:'channel.close',channelId:lastId},'12')).status,200);
 const limits=(await request(h,'info')).body.limits;assert.equal(limits.channelAcceptedCalls,100000);assert.equal(limits.channelReservedCalls,0);assert.equal(limits.channelAvailableCalls,0);
});
test('expiry releases unused call reservation in the same atomic refund and remains retry safe',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const h=harness(),owner=await funded(h),session=nativeGenerateKey();
 await h.storage.put('channelUsage',{version:1,acceptedCalls:99990,reservedCalls:0});
 const expiry=new Date(Date.now()+1000).toISOString(),opened=await openBudgetChannel(h,owner,session,5,expiry);assert.equal(opened.status,200);const id=opened.body.receipt.result.channelId,call=callEnvelope(session,id,1);
 assert.equal((await request(h,'channels/call',call)).status,200);assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:99991,reservedCalls:4});
 t.mock.timers.tick(1000);const before=durableRows(h);h.storage.failKey='transaction:';
 await assert.rejects(()=>h.ledger.alarm(),/Injected batch failure/);assert.deepEqual(durableRows(h),before,'Failed expiry must not release budget or move collateral');
 await h.ledger.alarm();assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:99991,reservedCalls:0});
 assert.equal((await h.storage.get('account:system:provider')).balanceAtoms,'100');assert.equal((await h.storage.get('account:system:channel:'+id)).balanceAtoms,'0');
 const after=durableRows(h);await h.ledger.alarm();assert.deepEqual(durableRows(h),after);assert.equal((await request(h,'channels/call',call)).body.replayed,true);assert.deepEqual(durableRows(h),after);
});
test('legacy channel budget migration paginates channel rows and excludes journal records',async()=>{
 const h=harness(),owner=await funded(h),session=nativeGenerateKey();
 const a=await openBudgetChannel(h,owner,session,4),b=await openBudgetChannel(h,owner,session,6);assert.equal(a.status,200);assert.equal(b.status,200);
 const first=a.body.receipt.result.channelId,second=b.body.receipt.result.channelId;
 for(let i=1;i<=2;i++)assert.equal((await request(h,'channels/call',callEnvelope(session,first,i))).status,200);
 assert.equal((await request(h,'channels/call',callEnvelope(session,second,1))).status,200);assert.equal((await submit(h,owner,{type:'channel.close',channelId:first},'12')).status,200);
 const closed=await h.storage.get('channel:'+first);
 for(let i=0;i<1001;i++){const id=i.toString(16).padStart(96,'0');await h.storage.put('channel:'+id,{...closed,channelId:id,escrow:'system:channel:'+id,capacity:1,sequence:1,depositAtoms:'100',spentAtoms:'100',remainingAtoms:'0'});}
 await h.storage.put('channel:journal:misleading',{capacity:10000,sequence:10000,status:'open'});h.storage.values.delete('channelUsage');
 const list=h.storage.list.bind(h.storage),pages=[];h.storage.list=async options=>{pages.push(options);return list(options);};
 const info=await request(h,'info');assert.equal(info.status,200);assert.equal(pages.length,2);assert.ok(pages.every(p=>p.end==='channel:g'&&p.limit===1000));
 assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:1004,reservedCalls:5});assert.equal(info.body.limits.channelAvailableCalls,98991);
 pages.length=0;assert.equal((await request(h,'info')).status,200);assert.equal(pages.length,0,'Persisted migration must not rescan history');
});
test('user checkpoint cutoff preserves reserved slots for channel expiry and refund',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.now()});const h=harness(),owner=await funded(h),session=nativeGenerateKey();
 const opened=await openBudgetChannel(h,owner,session,1,new Date(Date.now()+1000).toISOString());assert.equal(opened.status,200);
 const meta=await h.storage.get('meta');await h.storage.put('meta',{...meta,height:9900});
 const before=durableRows(h);const rejected=await openBudgetChannel(h,owner,session,1);assert.equal(rejected.body.error,'devnet_capacity');assert.deepEqual(durableRows(h),before);
 t.mock.timers.tick(1000);await h.ledger.alarm();assert.equal((await h.storage.get('meta')).height,9901);assert.deepEqual(await h.storage.get('channelUsage'),{version:1,acceptedCalls:0,reservedCalls:0});
 assert.equal((await h.storage.get('account:system:channel:'+opened.body.receipt.result.channelId)).balanceAtoms,'0');
});
test('history export remains available beyond the ordinary read allowance and stays bounded',async()=>{
 const h=harness();assert.equal((await request(h,'info')).status,200);const quota=await h.storage.get('quota'),key=Object.keys(quota.ips)[0];
 quota.ips[key].read=1800;quota.reads=50000;await h.storage.put('quota',quota);
 assert.equal((await request(h,'info')).status,429);assert.equal((await request(h,'export')).status,200);
 const next=await h.storage.get('quota');assert.equal(next.ips[key].auditReads,1);next.ips[key].auditReads=20000;await h.storage.put('quota',next);
 assert.equal((await request(h,'export')).body.error,'audit_read_limit');
});
test('owner can explicitly close and recover collateral using reserved checkpoint headroom',async()=>{
 const h=harness(),owner=await funded(h),session=nativeGenerateKey();const opened=await openBudgetChannel(h,owner,session,2);assert.equal(opened.status,200);
 await h.storage.put('meta',{...await h.storage.get('meta'),height:9900});
 const closed=await submit(h,owner,{type:'channel.close',channelId:opened.body.receipt.result.channelId},'12');
 assert.equal(closed.status,200);assert.equal(closed.body.receipt.result.refundedAtoms,'200');assert.equal((await h.storage.get('meta')).height,9901);assert.equal((await h.storage.get('channelUsage')).reservedCalls,0);
});
