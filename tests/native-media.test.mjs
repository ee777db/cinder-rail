import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeGenerateKey,nativeSign,nativeBase64url,nativeHash} from '../src/native-crypto.ts';
import {bytesHash,validateMediaChunk,uploadNativeMedia,serveNativeMedia,mediaRange} from '../src/native-media.ts';
const key=nativeGenerateKey(),now=Date.now();
const wav=new Uint8Array(26000);wav.set(new TextEncoder().encode('RIFF'),0);wav.set(new TextEncoder().encode('WAVE'),8);for(let i=12;i<wav.length;i++)wav[i]=i%251;
function body(index=0,bytes=wav){const chunk=bytes.slice(index*24576,(index+1)*24576),authorization={domain:'cinder.media-chunk.v1',chainId:'cinder-devnet-1',owner:key.address,uploadId:'a'.repeat(32),audioHash:bytesHash(bytes),mime:'audio/wav',bytes:bytes.length,chunks:Math.ceil(bytes.length/24576),index,chunkHash:bytesHash(chunk),validUntil:new Date(now+60000).toISOString()};return {authorization,signature:nativeSign(authorization,key.secretKey),data:nativeBase64url(chunk)};}
class Storage{values=new Map();async get(k){return structuredClone(this.values.get(k));}async put(k,v){for(const [name,value] of typeof k==='string'?[[k,v]]:Object.entries(k))this.values.set(name,structuredClone(value));}}
const store=()=>{const s=new Storage();s.values.set('account:'+key.address,{address:key.address,publicKey:key.publicKey});return s;};
test('signed chunks reject tampering, wrong network, deadline, and oversize',()=>{
 const good=body();assert.equal(validateMediaChunk(good,now).bytes.length,24576);
 for(const tweak of [{chainId:'other'},{validUntil:new Date(now).toISOString()},{bytes:5000000},{index:9},{chunkHash:'0'.repeat(96)}])assert.throws(()=>validateMediaChunk({...good,authorization:{...good.authorization,...tweak}},now));
 assert.throws(()=>validateMediaChunk({...good,data:good.data+'='},now));
});
test('audio upload is ordered, authenticated, immutable, retryable, and completed only after whole-file verification',async()=>{
 const s=store();await assert.rejects(uploadNativeMedia(s,body(1),now));
 const bad=body();bad.signature=bad.signature.replace(/^./,bad.signature[0]==='a'?'b':'a');await assert.rejects(uploadNativeMedia(s,bad,now));
 assert.equal((await uploadNativeMedia(s,body(),now)).complete,false);
 assert.equal((await uploadNativeMedia(s,body(),now)).replayed,true);
 const altered=body();altered.authorization.chunkHash='b'.repeat(96);await assert.rejects(uploadNativeMedia(s,altered,now));
 assert.equal((await uploadNativeMedia(s,body(1),now)).complete,true);
 const file=await s.get('media:file:'+key.address+':'+bytesHash(wav));assert.equal(file.bytes,26000);assert.equal(file.complete,true);
});
test('wrong full file commitment cannot create a publishable file',async()=>{
 const s=store();for(let i=0;i<2;i++){const b=body(i);b.authorization.audioHash='0'.repeat(96);b.signature=nativeSign(b.authorization,key.secretKey);if(!i)await uploadNativeMedia(s,b,now);else await assert.rejects(uploadNativeMedia(s,b,now));}
 assert.equal(await s.get('media:file:'+key.address+':'+'0'.repeat(96)),undefined);
});
test('audio playback requires a paid unexpired token and serves exact cross-chunk byte ranges',async()=>{
 const s=store();await uploadNativeMedia(s,body(),now);await uploadNativeMedia(s,body(1),now);
 const hash=bytesHash(wav),token=nativeBase64url(new Uint8Array(32).fill(2));const url='https://example.invalid/api/native/media/'+hash+'?token='+token;
 await assert.rejects(serveNativeMedia(s,new Request(url),hash,now));
 await s.put('music:access:'+nativeHash(token),{audioHash:hash,owner:key.address,expiresAt:now+1000});
 const response=await serveNativeMedia(s,new Request(url,{headers:{range:'bytes=24570-24590'}}),hash,now);assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 24570-24590/26000');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),wav.slice(24570,24591));
 const head=await serveNativeMedia(s,new Request(url,{method:'HEAD'}),hash,now);assert.equal(head.headers.get('content-length'),'26000');assert.equal((await head.arrayBuffer()).byteLength,0);
 await assert.rejects(serveNativeMedia(s,new Request(url),hash,now+1000));
});
test('range parser rejects multipart, unsatisfiable and numeric overflow ranges',()=>{
 assert.deepEqual(mediaRange('bytes=-20',100),{start:80,end:99,partial:true});
 for(const range of ['bytes=0-1,4-5','bytes=100-','bytes=50-40','bytes=-0','bytes=9999999999999999999999-'])assert.throws(()=>mediaRange(range,100));
});
