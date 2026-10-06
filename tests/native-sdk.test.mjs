import test from 'node:test';
import assert from 'node:assert/strict';
import {CinderNativeClient,nativeGenerateKey,nativeHash,nativeCanonical,nativeSign} from '../public/native-sdk.js';

test('SDK rejects a valid operator signature whose balanced postings exceed the exact payer authorization',()=>{
 const key=nativeGenerateKey(),client=new CinderNativeClient('https://example.invalid',key.publicKey);
 client.info={chainId:'cinder-devnet-1'};
 const transaction={domain:'cinder.transaction.v1',chainId:'cinder-devnet-1',sender:key.address,nonce:1,validUntil:new Date(Date.now()+60000).toISOString(),maxDebitAtoms:'112',actions:[{type:'transfer',to:'cin1'+'a'.repeat(96),amountAtoms:'100'}]};
 const sign=postings=>{const result={},checkpoint={domain:'cinder.checkpoint.v1',chainId:'cinder-devnet-1',transactionHash:nativeHash(nativeCanonical(transaction)),postingsHash:nativeHash(nativeCanonical(postings)),resultHash:nativeHash(nativeCanonical(result))};return {checkpoint,transaction,postings,result,signature:nativeSign(transaction,key.secretKey),checkpointSignature:nativeSign(checkpoint,key.secretKey)};};
 assert.equal(client.verifyReceipt(sign([{account:key.address,deltaAtoms:'-112'},{account:'system:fees',deltaAtoms:'12'},{account:'cin1'+'a'.repeat(96),deltaAtoms:'100'}]),transaction),true);
 // Refunding the extra debit in another posting cannot hide gross overauthorization.
 assert.throws(()=>client.verifyReceipt(sign([{account:key.address,deltaAtoms:'-113'},{account:key.address,deltaAtoms:'1'},{account:'system:fees',deltaAtoms:'12'},{account:'cin1'+'a'.repeat(96),deltaAtoms:'100'}]),transaction),/gross spending cap/);
});

test('SDK retries a completed playback payment by recovering access, without signing or paying again',async()=>{
 const key=nativeGenerateKey(),client=new CinderNativeClient('https://example.invalid');let authorizations=0,payments=0,accesses=0;
 client.authorize=async(_key,actions,cap)=>{authorizations++;return {transaction:{sender:key.address,maxDebitAtoms:cap,actions},signature:'public-fixture'};};
 client.submit=async envelope=>{payments++;return {txHash:nativeHash(nativeCanonical(envelope.transaction)),receipt:{transaction:envelope.transaction}};};
 client.musicAccess=async()=>{accesses++;if(accesses===1)throw new Error('Temporary access transport failure');return {playbackToken:'fixture'};};
 let failed;try{await client.listen(key,'a'.repeat(96),'112');}catch(error){failed=error;}
 assert.equal(failed.paid.txHash,failed.pendingTransactionHash);assert.ok(failed.listenId);assert.equal(failed.secretKey,undefined);
 const recovered=await client.listen(key,'a'.repeat(96),'112');
 assert.equal(recovered.txHash,failed.pendingTransactionHash);assert.equal(recovered.listenId,failed.listenId);assert.equal(authorizations,1);assert.equal(payments,1);assert.equal(accesses,2);
});

test('concurrent SDK playback purchases share one authorization and one payment',async()=>{
 const key=nativeGenerateKey(),client=new CinderNativeClient('https://example.invalid');let count=0;
 client.authorize=async(_key,actions,cap)=>{await Promise.resolve();return {transaction:{sender:key.address,maxDebitAtoms:cap,actions},signature:'public-fixture'};};
 client.submit=async envelope=>{count++;return {txHash:nativeHash(nativeCanonical(envelope.transaction)),receipt:{transaction:envelope.transaction}};};
 client.musicAccess=async()=>({playbackToken:'fixture'});
 const [a,b]=await Promise.all([client.listen(key,'a'.repeat(96),'112'),client.listen(key,'a'.repeat(96),'112')]);
 assert.equal(a.txHash,b.txHash);assert.equal(a.listenId,b.listenId);assert.equal(count,1);
});
