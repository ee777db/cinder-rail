import {sha384} from '@noble/hashes/sha2.js';
import {nativeCanonical,nativeHash,nativeUnbase64url,nativeVerify} from './native-crypto.ts';
import {NativeError,NATIVE_CHAIN,NATIVE_ADDRESS,NATIVE_DIGEST,exact,type NativeAccount} from './native-core.ts';

export const MEDIA_CHUNK_BYTES=24576;
export const MEDIA_MAX_BYTES=4*1024*1024;
export const MEDIA_MIMES=['audio/mpeg','audio/wav','audio/ogg'];
export const bytesHash=(bytes:Uint8Array)=>Array.from(sha384(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export function mediaManifest(a:any){return {owner:a.owner,uploadId:a.uploadId,audioHash:a.audioHash,mime:a.mime,bytes:a.bytes,chunks:a.chunks};}
export function validateMediaChunk(body:any,now:number){
  exact(body,['authorization','signature','data']);const a=body.authorization;
  exact(a,['domain','chainId','owner','uploadId','audioHash','mime','bytes','chunks','index','chunkHash','validUntil']);
  if(a.domain!=='cinder.media-chunk.v1'||a.chainId!==NATIVE_CHAIN||typeof a.owner!=='string'||!NATIVE_ADDRESS.test(a.owner))throw new NativeError('media_domain','Invalid media authorization.');
  if(typeof a.uploadId!=='string'||!/^[a-f0-9]{32}$/.test(a.uploadId)||typeof a.audioHash!=='string'||!NATIVE_DIGEST.test(a.audioHash)||typeof a.chunkHash!=='string'||!NATIVE_DIGEST.test(a.chunkHash))throw new NativeError('media_hash','Invalid upload identifier or SHA-384 commitment.');
  if(!MEDIA_MIMES.includes(a.mime)||!Number.isSafeInteger(a.bytes)||a.bytes<12||a.bytes>MEDIA_MAX_BYTES||a.chunks!==Math.ceil(a.bytes/MEDIA_CHUNK_BYTES)||!Number.isSafeInteger(a.index)||a.index<0||a.index>=a.chunks)throw new NativeError('media_size','Use MPEG, WAV or Ogg audio up to 4 MiB, split into 24 KiB chunks.');
  const deadline=typeof a.validUntil==='string'?Date.parse(a.validUntil):NaN;
  if(!Number.isFinite(deadline)||new Date(deadline).toISOString()!==a.validUntil||deadline<=now||deadline>now+1800000)throw new NativeError('media_expired','Sign an upload deadline within 30 minutes.');
  const length=a.index===a.chunks-1?a.bytes-a.index*MEDIA_CHUNK_BYTES:MEDIA_CHUNK_BYTES;
  let bytes:Uint8Array;try{bytes=nativeUnbase64url(body.data,length);}catch{throw new NativeError('media_encoding','Invalid canonical base64url audio chunk.');}
  if(bytesHash(bytes)!==a.chunkHash)throw new NativeError('media_chunk_hash','The uploaded bytes do not match the authorized chunk.');
  return {authorization:a,bytes,manifest:mediaManifest(a)};
}
function supportedAudio(bytes:Uint8Array,mime:string){
  const ascii=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
  if(mime==='audio/wav')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE';
  if(mime==='audio/ogg')return ascii(0,4)==='OggS';
  return ascii(0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224);
}
/** Signed immutable chunks; the final SHA-384 commitment is checked before a publication can use the file. */
export async function uploadNativeMedia(storage:DurableObjectStorage,body:any,now:number){
  const {authorization:a,bytes,manifest}=validateMediaChunk(body,now);
  const account=await storage.get<NativeAccount>('account:'+a.owner);
  if(!account?.publicKey||!nativeVerify(a,body.signature,account.publicKey))throw new NativeError('media_signature','Audio upload requires the registered owner’s ML-DSA signature.',401);
  const prefix='media:upload:'+a.owner+':'+a.uploadId;
  let record:any=await storage.get(prefix);
  if(record&&nativeCanonical(record.manifest)!==nativeCanonical(manifest))throw new NativeError('media_manifest_conflict','This upload ID belongs to another immutable file.',409);
  if(record&&a.index<record.next){const saved=await storage.get<Uint8Array>(prefix+':'+a.index);if(!saved||bytesHash(saved)!==a.chunkHash)throw new NativeError('media_chunk_conflict','A previously accepted chunk cannot be replaced.',409);return {uploadId:a.uploadId,audioHash:a.audioHash,complete:record.complete,next:record.next,replayed:true};}
  const updates:Record<string,any>={};
  if(!record){
    if(a.index!==0)throw new NativeError('media_chunk_order','Upload chunks sequentially, beginning with zero.',409);
    const total=await storage.get<number>('media:count')||0,ownerCount=await storage.get<number>('media:owner:'+a.owner)||0;
    if(total>=200||ownerCount>=10)throw new NativeError('media_capacity','The test network allows 200 uploads in total, ten per account.',429);
    record={manifest,next:0,complete:false,createdAt:new Date(now).toISOString()};updates['media:count']=total+1;updates['media:owner:'+a.owner]=ownerCount+1;
  }
  if(a.index!==record.next)throw new NativeError('media_chunk_order','Continue from the next accepted chunk.',409);
  if(a.index===0&&!supportedAudio(bytes,a.mime))throw new NativeError('media_format','The audio header does not match the declared media type.');
  record.next++;updates[prefix+':'+a.index]=bytes;
  if(record.next===a.chunks){
    const digest=sha384.create();for(let i=0;i<a.chunks;i++){const part=i===a.index?bytes:await storage.get<Uint8Array>(prefix+':'+i);if(!part)throw new NativeError('media_incomplete','An audio chunk is missing.',409);digest.update(part);}
    const hash=Array.from(digest.digest(),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==a.audioHash)throw new NativeError('media_file_hash','The complete audio file does not match its signed commitment.',409);
    record.complete=true;updates['media:file:'+a.owner+':'+a.audioHash]={...manifest,prefix,complete:true};
  }
  updates[prefix]=record;await storage.put(updates);
  return {uploadId:a.uploadId,audioHash:a.audioHash,complete:record.complete,next:record.next};
}

export function mediaRange(header:string|null,size:number):{start:number,end:number,partial:boolean}{
  if(!header)return {start:0,end:size-1,partial:false};
  const match=header.match(/^bytes=(\d*)-(\d*)$/);if(!match||(!match[1]&&!match[2]))throw new NativeError('invalid_range','Use one byte range.',416);
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));
  const end=match[1]?(match[2]?Math.min(Number(match[2]),size-1):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw new NativeError('invalid_range','Byte range is outside this audio file.',416);
  return {start,end,partial:true};
}
export async function serveNativeMedia(storage:DurableObjectStorage,request:Request,audioHash:string,now:number){
  const token=new URL(request.url).searchParams.get('token');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new NativeError('music_access','A paid playback token is required.',401);
  const access:any=await storage.get('music:access:'+nativeHash(token));
  if(!access||access.audioHash!==audioHash||access.expiresAt<=now)throw new NativeError('music_access','This playback token is invalid or expired.',403);
  const file:any=await storage.get('media:file:'+access.owner+':'+audioHash);
  if(!file?.complete)throw new NativeError('media_missing','The published audio file is unavailable.',404);
  let range;try{range=mediaRange(request.headers.get('range'),file.bytes);}catch(error){if(error instanceof NativeError&&error.status===416)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+file.bytes}});throw error;}
  const headers={'Content-Type':file.mime,'Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),'Cache-Control':'private, no-store','Content-Disposition':'inline',...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${file.bytes}`}:{})};
  if(request.method==='HEAD')return new Response(null,{status:range.partial?206:200,headers});
  // Read at most the requested file (4 MiB) before leaving the object lock. No key or token enters public receipts.
  const output=new Uint8Array(range.end-range.start+1);let offset=0;
  for(let i=Math.floor(range.start/MEDIA_CHUNK_BYTES);i<=Math.floor(range.end/MEDIA_CHUNK_BYTES);i++){
    const part=await storage.get<Uint8Array>(file.prefix+':'+i);if(!part)throw new NativeError('media_missing','An audio chunk is unavailable.',503);
    const from=Math.max(0,range.start-i*MEDIA_CHUNK_BYTES),to=Math.min(part.length,range.end-i*MEDIA_CHUNK_BYTES+1);output.set(part.subarray(from,to),offset);offset+=to-from;
  }
  return new Response(output,{status:range.partial?206:200,headers});
}
