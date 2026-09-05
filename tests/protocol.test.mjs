import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonical,base64url,unbase64url,sha256,validPublicKey,selectInput} from '../src/protocol.ts';
test('canonicalization is order-independent and Unicode safe',()=>{
 assert.equal(canonical({z:[1,{b:'火',a:'\"'}],a:0}),canonical({a:0,z:[1,{a:'\"',b:'火'}]}));
 assert.notEqual(canonical({a:'1'}),canonical({a:1}));
});
test('hash matches standard SHA-256 abc vector',async()=>assert.equal(await sha256('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
test('P256 signatures verify exact payload and reject changed input',async()=>{
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const payload=new TextEncoder().encode(canonical({input:'火',amount:10}));
 const sig=base64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,payload));
 assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,unbase64url(sig),payload),true);
 assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,unbase64url(sig),new TextEncoder().encode('changed')),false);
 const pub=await crypto.subtle.exportKey('jwk',pair.publicKey);assert(validPublicKey(pub));assert(!validPublicKey({...pub,d:'private'}));
});
test('input limits and supported service are enforced',()=>{
 assert.throws(()=>selectInput('unknown','abc'));assert.throws(()=>selectInput('inference','x'.repeat(1201)));assert.throws(()=>selectInput('hash',' '));
 assert.equal(selectInput('hash','abc').selected.amountMicros,10);
});
