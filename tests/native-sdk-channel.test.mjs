import test from 'node:test';
import assert from 'node:assert/strict';
import {CinderNativeClient} from '../public/native-sdk.js';
import {nativeGenerateKey,nativeHash,nativeCanonical,nativeSign} from '../src/native-crypto.ts';
import {NATIVE_CHAIN,NATIVE_SUPPLY,NATIVE_SERVICES,applyNativeTransaction,txHash} from '../src/native-core.ts';
import {openChannel,applyChannelCall} from '../src/native-channel.ts';

const operator=nativeGenerateKey(),owner=nativeGenerateKey(),session=nativeGenerateKey(),other=nativeGenerateKey();
const NOW=Date.now()-60000,iso=n=>new Date(n).toISOString(),zero='0'.repeat(96);
const info={chainId:NATIVE_CHAIN,signatureAlgorithm:'ML-DSA-65',signer:{publicKey:operator.publicKey},services:NATIVE_SERVICES};
function snapshot(nonce=0){return Object.fromEntries([owner.address,'system:reserve','system:fees','system:provider'].map(address=>[address,{address,balanceAtoms:address===owner.address?NATIVE_SUPPLY:'0',nonce:address===owner.address?nonce:0,claimedFaucet:false,createdAt:iso(NOW),...(address===owner.address?{publicKey:owner.publicKey}:{})}]));}
function transaction(action,nonce=1,now=NOW){return {domain:'cinder.transaction.v1',chainId:NATIVE_CHAIN,sender:owner.address,nonce,validUntil:iso(now+120000),maxDebitAtoms:NATIVE_SUPPLY,actions:[action]};}
function receipt(tx,postings,result,{now=NOW,signature=nativeSign(tx,owner.secretKey),height=1}={}){
 const checkpoint={domain:'cinder.checkpoint.v1',chainId:NATIVE_CHAIN,height,previousHash:zero,transactionHash:txHash(tx),postingsHash:nativeHash(nativeCanonical(postings)),resultHash:nativeHash(nativeCanonical(result)),timestamp:iso(now),mode:'single-operator-devnet'};
 return {transaction:tx,signature,checkpoint,checkpointSignature:nativeSign(checkpoint,operator.secretKey),postings,result};
}
function channelFixture({expired=false}={}){
 const openedAt=expired?NOW-86400000:NOW;
 const tx=transaction({type:'channel.open',sessionPublicKey:session.publicKey,capacity:3,expiresAt:iso(openedAt+3600000),service:'hash'},1,openedAt);
 const opened=openChannel(snapshot(),tx,openedAt),openingReceipt=receipt(tx,opened.postings,opened.result,{now:openedAt});
 const input='real bounded work',message={domain:'cinder.channel-call.v1',chainId:NATIVE_CHAIN,channelId:txHash(tx),sequence:1,inputHash:nativeHash(input)},signature=nativeSign(message,session.secretKey);
 const call=applyChannelCall(opened.accounts,opened.channel,message,signature,input,openedAt+1000);
 return {tx,opened,openingReceipt,envelope:{message,signature,input},response:{journal:call.journal,result:call.result,channel:call.channel}};
}
async function mocked(routes,fn){const original=globalThis.fetch;globalThis.fetch=async(url,options={})=>{
 const path=new URL(url).pathname.replace('/api/native',''),body=options.body?JSON.parse(options.body):undefined;
 const handler=typeof routes==='function'?routes:routes[path];if(handler===undefined)throw new Error('Unexpected request '+path);
 const data=typeof handler==='function'?await handler(body,path,options):handler;
 return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };try{return await fn();}finally{globalThis.fetch=original;}}
function client(){const c=new CinderNativeClient('https://example.invalid',operator.publicKey);c.info=info;return c;}
function routes(f,response=f.response){return {'/info':info,['/transactions/'+txHash(f.tx)]:{txHash:txHash(f.tx),receipt:f.openingReceipt},['/accounts/'+owner.address]:snapshot()[owner.address],'/channels/call':response};}

test('SDK fresh client authenticates and caches channel opening terms',async()=>{
 const f=channelFixture();let reads=0;const r=routes(f);r['/transactions/'+txHash(f.tx)]=()=>{reads++;return {txHash:txHash(f.tx),receipt:f.openingReceipt};};
 await mocked(r,async()=>{const c=client();assert.deepEqual(await c.submitChannelCall(f.envelope,session.publicKey),f.response);assert.deepEqual(await c.submitChannelCall(f.envelope,session.publicKey),f.response);assert.equal(reads,1);});
});
test('SDK preserves authenticated exact replay after expiry, including original signature',async()=>{
 const f=channelFixture({expired:true}),retry={...f.envelope,signature:nativeSign(f.envelope.message,session.secretKey)};
 await mocked(routes(f,{...f.response,replayed:true}),async()=>assert.equal((await client().submitChannelCall(retry,session.publicKey)).replayed,true));
});
const corruptions={
 'journal domain':r=>r.journal.domain='other', 'journal chain':r=>r.journal.chainId='other',
 'journal channel':r=>r.journal.channelId=zero, 'journal sequence':r=>r.journal.sequence=2,
 'journal input hash':r=>r.journal.inputHash=zero, 'journal price':r=>r.journal.amountAtoms='999',
 'journal time before opening':r=>r.journal.recordedAt=iso(NOW-1),
 'journal time at expiry':r=>r.journal.recordedAt=iso(NOW+3600000),
 'journal noncanonical time':r=>r.journal.recordedAt='2026-01-01',
 'first predecessor':r=>r.journal.previousHash=zero,
 'output':r=>r.journal.output=zero, 'output digest':r=>r.journal.outputHash=zero,
 'result output':r=>r.result.output=zero, 'result channel':r=>r.result.channelId=zero,
 'result sequence':r=>r.result.sequence=2, 'result fees':r=>r.result.feeAtoms='1',
 'result settled':r=>r.result.settledAtoms='100', 'result spent':r=>r.result.spentAtoms='101',
 'result remaining':r=>r.result.remainingAtoms='0', 'result authorization amount':r=>r.result.authorizedAtoms='0',
 'channel key':r=>r.channel.sessionPublicKey=other.publicKey, 'channel owner':r=>r.channel.owner=other.address,
 'channel service':r=>r.channel.service='inference', 'channel price':r=>r.channel.priceAtoms='1',
 'channel capacity':r=>r.channel.capacity=4, 'channel deposit':r=>r.channel.depositAtoms='1000',
 'channel spent':r=>r.channel.spentAtoms='999', 'channel remaining':r=>r.channel.remainingAtoms='999',
 'channel identifier':r=>r.channel.channelId=zero, 'channel sequence':r=>r.channel.sequence=2,
 'channel status':r=>r.channel.status='closed', 'channel expiry':r=>r.channel.expiresAt=iso(NOW+7200000),
 'unknown journal field':r=>r.journal.extra=true, 'unknown channel field':r=>r.channel.extra=true,
};
for(const [name,mutate] of Object.entries(corruptions))test('SDK rejects altered '+name,async()=>{
 const f=channelFixture(),changed=structuredClone(f.response);mutate(changed);
 // A proxy can recompute these hashes; doing so must not legitimize forged metadata.
 changed.result.journalHash=nativeHash(nativeCanonical(changed.journal));changed.channel.journalHead=changed.result.journalHash;
 await mocked(routes(f,changed),async()=>assert.rejects(client().submitChannelCall(f.envelope,session.publicKey)));
});
test('SDK rejects substituted opening public key despite valid operator receipt',async()=>{
 const f=channelFixture(),r=routes(f);r['/accounts/'+owner.address]={...snapshot()[owner.address],publicKey:other.publicKey};
 await mocked(r,async()=>assert.rejects(client().submitChannelCall(f.envelope,session.publicKey),/authorization/));
});
test('SDK rejects caller-provided session key differing from signed opening',async()=>{
 const f=channelFixture();await mocked(routes(f),async()=>assert.rejects(client().submitChannelCall(f.envelope,other.publicKey),/authorization/));
});
test('SDK rejects validly signed operator opening that changes authorized capacity',async()=>{
 const f=channelFixture(),changed=structuredClone(f.openingReceipt.result);changed.channel.capacity=4;
 f.openingReceipt=receipt(f.tx,f.opened.postings,changed);
 await mocked(routes(f),async()=>assert.rejects(client().submitChannelCall(f.envelope,session.publicKey),/terms mismatch/));
});
test('SDK checks supplied predecessor and validates raw input before posting a call',async()=>{
 const f=channelFixture();await mocked(routes(f),async()=>{
  const c=client();await assert.rejects(c.submitChannelCall(f.envelope,session.publicKey,zero),/predecessor/);
  await assert.rejects(c.submitChannelCall({...f.envelope,input:'changed'},session.publicKey),/input/);
 });
});
test('SDK remembers journal hash and rejects same authorization with changed unsigned recording time',async()=>{
 const f=channelFixture(),changed=structuredClone(f.response);changed.journal.recordedAt=iso(NOW+2000);changed.result.journalHash=nativeHash(nativeCanonical(changed.journal));changed.channel.journalHead=changed.result.journalHash;
 let calls=0;await mocked({...routes(f),'/channels/call':()=>calls++?changed:f.response},async()=>{
  const c=client();await c.submitChannelCall(f.envelope,session.publicKey);await assert.rejects(c.submitChannelCall(f.envelope,session.publicKey),/changed an accepted journal/);
 });
});
test('lost channel-opening response retains the exact authorization and session secret for retry',async()=>{
 const submissions=[];let saved;
 await mocked(async(body,path)=>{
  if(path==='/info')return info;
  if(path==='/accounts/'+owner.address)return {...snapshot()[owner.address],nonce:saved?1:0};
  if(path==='/submit'){
   submissions.push(body);if(!saved){const opened=openChannel(snapshot(),body.transaction,Date.now());saved={txHash:txHash(body.transaction),receipt:receipt(body.transaction,opened.postings,opened.result,{now:Date.now(),signature:body.signature}),account:{...snapshot()[owner.address],nonce:1}};throw new Error('Connection lost after durable commit');}
   return {...saved,replayed:true};
  }throw new Error('Unexpected route '+path);
 },async()=>{
  const c=client();let failure;try{await c.openChannel(owner,3);}catch(error){failure=error;}
  assert.equal(failure.pendingTransactionHash,saved.txHash);assert.equal('sessionKey'in failure,false);assert.equal('secretKey'in failure,false);
  const reopened=await c.openChannel(owner,3);assert.equal(reopened.replayed,true);assert.equal(reopened.sessionKey.publicKey,saved.receipt.transaction.actions[0].sessionPublicKey);
  assert.deepEqual(submissions[0],submissions[1]);assert.equal(reopened.channel.channelId,saved.txHash);
  const call=c.authorizeChannelCall(reopened.sessionKey,saved.txHash,1,'still usable');assert.equal(typeof call.signature,'string');
 });
});
test('concurrent identical openings share one authorization and session key',async()=>{
 let submissions=0;
 await mocked(async(body,path)=>{
  if(path==='/accounts/'+owner.address)return snapshot()[owner.address];
  if(path==='/submit'){submissions++;const opened=openChannel(snapshot(),body.transaction,Date.now());return {txHash:txHash(body.transaction),receipt:receipt(body.transaction,opened.postings,opened.result,{now:Date.now(),signature:body.signature})};}
  throw new Error('Unexpected route '+path);
 },async()=>{const c=client(),[a,b]=await Promise.all([c.openChannel(owner,3),c.openChannel(owner,3)]);assert.equal(submissions,1);assert.equal(a.sessionKey.secretKey,b.sessionKey.secretKey);});
});

function jobFixture(status='complete'){
 const input='bounded hash',tx=transaction({type:'compute',service:'hash',inputHash:nativeHash(input)}),transition=applyNativeTransaction(snapshot(),tx,NOW),reservation=receipt(tx,transition.postings,transition.result);
 const hash=txHash(tx),complete=status==='complete',output=nativeHash(input),refundAtoms=complete?'0':'100';
 const settlement={domain:'cinder.compute-settlement.v1',chainId:NATIVE_CHAIN,requestTxHash:hash,status,outputHash:complete?nativeHash(output):null,amountAtoms:'100'};
 const result={status,requestTxHash:hash,service:'hash',model:'sha384-v1',refundAtoms,...(complete?{output}:{reason:'provider_unavailable_or_reservation_timeout'}),evidence:'operator-signed provenance; not proof of correct inference'};
 const postings=[{account:transition.compute.escrow,deltaAtoms:'-100'},{account:complete?'system:provider':owner.address,deltaAtoms:'100'}];
 const settled=receipt(settlement,postings,result,{now:NOW+1000,signature:null,height:2});
 const job={txHash:hash,sender:owner.address,...transition.compute,status,startedAt:NOW,refundAtoms,...(complete?{output}:{}),receipt:settled};
 return {hash,job,routes:{['/jobs/'+hash]:job,['/transactions/'+hash]:{txHash:hash,receipt:reservation},['/accounts/'+owner.address]:snapshot()[owner.address]}};
}
for(const status of ['complete','failed'])test('SDK accepts authenticated '+status+' compute settlement',async()=>{
 const f=jobFixture(status);await mocked(f.routes,async()=>assert.deepEqual(await client().job(f.hash),f.job));
});
for(const status of ['complete','failed'])test('SDK fails closed for '+status+' without a receipt',async()=>{
 const f=jobFixture(status);delete f.job.receipt;await mocked(f.routes,async()=>assert.rejects(client().job(f.hash),/requires a settlement receipt/));
});
for(const [name,mutate] of Object.entries({
 'refund':j=>j.refundAtoms='100', 'request':j=>j.txHash=zero,'service':j=>j.service='inference',
 'amount':j=>j.amountAtoms='500','escrow':j=>j.escrow='system:fees','input':j=>j.inputHash=zero,
 'status':j=>j.status='unknown','output':j=>j.output=zero,
}))test('SDK rejects unsigned job '+name+' alteration',async()=>{
 const f=jobFixture();mutate(f.job);await mocked(f.routes,async()=>assert.rejects(client().job(f.hash)));
});
for(const [name,mutate] of Object.entries({
 'domain':r=>r.transaction.domain='other', 'chain':r=>r.transaction.chainId='other',
 'request':r=>r.transaction.requestTxHash=zero,'model':r=>r.result.model='unattested-model',
 'refund':r=>r.result.refundAtoms='100','service':r=>r.result.service='inference',
 'payment target':r=>r.postings[1].account=other.address,
}))test('SDK rejects signed but invalid settlement '+name,async()=>{
 const f=jobFixture(),r=structuredClone(f.job.receipt);mutate(r);f.job.receipt=receipt(r.transaction,r.postings,r.result,{now:NOW+1000,signature:null,height:2});
 await mocked(f.routes,async()=>assert.rejects(client().job(f.hash)));
});
