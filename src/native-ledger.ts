import {DurableObject} from 'cloudflare:workers';
import {openChannel,closeChannel,expireChannel,applyChannelCall,authenticateChannelCall,channelAccounts,channelCallAccounts,type NativeChannel} from './native-channel.ts';
import {uploadNativeMedia,serveNativeMedia} from './native-media.ts';
import {applyMusic,musicAccounts,musicListenKey,type MusicState} from './native-music.ts';
import {applyEconomy,economyAccounts,economyInfo,economyWallet} from './native-economy.ts';
import {nativeGenerateKey,nativeVerify,nativeSign,nativeHash,nativeAddress,nativeCanonical,nativeBase64url,type NativeKey} from './native-crypto';
import {NATIVE_CHAIN,NATIVE_SUPPLY,NATIVE_FAUCET,NATIVE_SERVICES,NATIVE_ADDRESS,NATIVE_DIGEST,NativeError,exact,validateTransaction,applyNativeTransaction,touchedAccounts,txHash,type NativeAccount,type Posting} from './native-core';
interface NativeEnv {NATIVE:DurableObjectNamespace<NativeLedger>;AI:Ai;}
const reply=(body:any,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const accountKey=(address:string)=>'account:'+address;
const epoch=()=>new Date().toISOString();
interface Meta {height:number;hash:string;accounts:number;supplyAtoms:string;genesisAt:string;}
interface Job {txHash:string;sender:string;service:string;amountAtoms:string;escrow:string;status:'pending'|'complete'|'failed';startedAt:number;output?:string;receipt?:any;refundAtoms?:string;}
interface ChannelUsage {version:1;acceptedCalls:number;reservedCalls:number;}
const CHANNEL_LIFETIME_CALL_LIMIT=100000;
const CHECKPOINT_LIMIT=10000;
const USER_CHECKPOINT_LIMIT=9900;
export async function handleNative(request:Request,env:NativeEnv):Promise<Response>{
  let response:Response;
  if(request.method==='OPTIONS')response=new Response(null,{status:204});
  else {
    let body:string|undefined;
    if(request.method==='POST'){
      if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'content_type',message:'Use application/json.'},400);
      const reader=request.body?.getReader();if(!reader)return reply({error:'body_required',message:'A JSON body is required.'},400);
      const chunks:Uint8Array[]=[];let size=0;
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>48000){await reader.cancel();return reply({error:'too_large',message:'Native request limit is 48000 bytes.'},413);}chunks.push(value);}
      const buffer=new Uint8Array(size);let pos=0;for(const chunk of chunks){buffer.set(chunk,pos);pos+=chunk.byteLength;}body=new TextDecoder().decode(buffer);
    }
    const url=new URL(request.url);url.hostname='internal';
    response=await env.NATIVE.get(env.NATIVE.idFromName(NATIVE_CHAIN)).fetch(url.toString(),{method:request.method,headers:{'content-type':'application/json','x-native-ip':request.headers.get('cf-connecting-ip')||'localhost','range':request.headers.get('range')||''},body});
  }
  const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');headers.set('Access-Control-Allow-Headers','content-type');headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
}
export class NativeLedger extends DurableObject<NativeEnv> {
  private key?:NativeKey;
  private async initialize(){
    if(!this.key){this.key=await this.ctx.storage.get<NativeKey>('issuer');if(!this.key){this.key=nativeGenerateKey();await this.ctx.storage.put('issuer',this.key);}}
    if(!await this.ctx.storage.get('meta')){
      const genesisAt=epoch();const genesis={domain:'cinder.genesis.v1',chainId:NATIVE_CHAIN,symbol:'CINDER',decimals:6,supplyAtoms:NATIVE_SUPPLY,allocation:'system:reserve',operatorPublicKey:this.key.publicKey,createdAt:genesisAt,consensus:'single-operator-devnet',resources:{symbol:'WORK',supply:'1000000',unit:'One SHA-384 operation, one to 4000 text characters',issuance:'finite-provider-inventory',cashRedemption:false}};
      const hash=nativeHash(nativeCanonical(genesis));
      const genesisRecord={genesis,signature:nativeSign(genesis,this.key.secretKey),hash};
      const meta:Meta={height:0,hash,accounts:0,supplyAtoms:NATIVE_SUPPLY,genesisAt};
      await this.ctx.storage.put({'meta':meta,'genesis':genesisRecord,channelUsage:{version:1,acceptedCalls:0,reservedCalls:0},[accountKey('system:reserve')]:{address:'system:reserve',balanceAtoms:NATIVE_SUPPLY,nonce:0,claimedFaucet:false,createdAt:genesisAt},[accountKey('system:fees')]:{address:'system:fees',balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:genesisAt},[accountKey('system:provider')]:{address:'system:provider',balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:genesisAt}});
    }
    await this.loadChannelUsage();
  }
  private async loadChannelUsage():Promise<ChannelUsage>{
    let usage=await this.ctx.storage.get<ChannelUsage>('channelUsage');
    if(!usage){
      usage={version:1,acceptedCalls:0,reservedCalls:0};let cursor='channel:',scanned=0;
      // Native channel IDs are hexadecimal; this range excludes channel:journal:.
      while(true){
        const page=await this.ctx.storage.list<NativeChannel>({prefix:'channel:',startAfter:cursor,end:'channel:g',limit:1000});
        for(const [key,channel] of page){
          if(!/^channel:[a-f0-9]{96}$/.test(key))continue;
          if(++scanned>100000||channel.channelId!==key.slice(8)||!['open','closed'].includes(channel.status)||!Number.isSafeInteger(channel.capacity)||channel.capacity<1||channel.capacity>10000||!Number.isSafeInteger(channel.sequence)||channel.sequence<0||channel.sequence>channel.capacity)throw new NativeError('channel_usage_state','Cannot reconstruct a valid channel storage budget.',503);
          usage.acceptedCalls+=channel.sequence;
          if(channel.status==='open')usage.reservedCalls+=channel.capacity-channel.sequence;
        }
        if(page.size<1000)break;cursor=[...page.keys()].at(-1)!;
      }
      await this.ctx.storage.put('channelUsage',usage);
    }
    if(usage.version!==1||!Number.isSafeInteger(usage.acceptedCalls)||usage.acceptedCalls<0||!Number.isSafeInteger(usage.reservedCalls)||usage.reservedCalls<0)throw new NativeError('channel_usage_state','Invalid channel storage budget.',503);
    return usage;
  }
  private async releaseChannelCapacity(channel:NativeChannel):Promise<ChannelUsage>{
    const usage=await this.loadChannelUsage(),unused=channel.capacity-channel.sequence;
    if(usage.reservedCalls<unused)throw new NativeError('channel_usage_state','Channel reservation exceeds the recorded storage budget.',503);
    return {...usage,reservedCalls:usage.reservedCalls-unused};
  }
  private async quota(ip:string,kind:'read'|'audit'|'write'|'register'|'inference'|'upload'|'channel'){
    const day=epoch().slice(0,10);let q:any=await this.ctx.storage.get('quota');
    if(!q||q.day!==day)q={day,salt:crypto.randomUUID(),reads:0,writes:0,registrations:0,inferences:0,uploads:0,ips:{}};
    const key=nativeHash(q.salt+ip);let client=q.ips[key];
    if(!client){if(Object.keys(q.ips).length>=2048)throw new NativeError('daily_limit','Daily devnet visitor capacity reached.',429);client={read:0,write:0,register:0,upload:0};}
    if(kind==='read'){if(client.read>=1800||q.reads>=50000)throw new NativeError('read_limit','Daily devnet read allowance reached.',429);client.read++;q.reads++;}
    else if(kind==='audit'){if((client.auditReads||0)>=20000||(q.auditReads||0)>=100000)throw new NativeError('audit_read_limit','Daily history export allowance reached.',429);client.auditReads=(client.auditReads||0)+1;q.auditReads=(q.auditReads||0)+1;}
    else if(kind==='channel'){if((client.calls||0)>=250000||(q.channelCalls||0)>=500000)throw new NativeError('channel_daily_limit','Daily channel call allowance reached.',429);client.calls=(client.calls||0)+1;q.channelCalls=(q.channelCalls||0)+1;}
    else if(kind==='upload'){if((client.upload||0)>=2000||(q.uploads||0)>=20000)throw new NativeError('upload_limit','Daily signed audio upload allowance reached.',429);client.upload=(client.upload||0)+1;q.uploads=(q.uploads||0)+1;}
    else if(kind==='inference'){if(q.inferences>=30)throw new NativeError('inference_limit','The native devnet daily inference budget is exhausted.',429);q.inferences++;}
    else {if(client.write>=300||q.writes>=10000)throw new NativeError('write_limit','Daily devnet write allowance reached.',429);client.write++;q.writes++;if(kind==='register'){if(client.register>=20||q.registrations>=500)throw new NativeError('registration_limit','Daily native account registration allowance reached.',429);client.register++;q.registrations++;}}
    q.ips[key]=client;await this.ctx.storage.put('quota',q);
  }
  private async publicInfo(){
    const meta=(await this.ctx.storage.get<Meta>('meta'))!;const reserve=(await this.ctx.storage.get<NativeAccount>(accountKey('system:reserve')))!;
    const usage=await this.loadChannelUsage();
    return {chainId:NATIVE_CHAIN,symbol:'CINDER',decimals:6,assetId:NATIVE_CHAIN+'/native',supplyAtoms:NATIVE_SUPPLY,reserveAtoms:reserve.balanceAtoms,circulatingTestAtoms:(BigInt(NATIVE_SUPPLY)-BigInt(reserve.balanceAtoms)).toString(),faucetAtoms:NATIVE_FAUCET,feeBaseAtoms:'10',feePerActionAtoms:'2',maxBatchActions:16,applications:['transfers','music-paid-access','resource-redemption','CINDER/WORK-spot','prefunded-compute-channels'],channel:{capacity:10000,maxLifetimeMs:86400000,perCallPriceAtoms:'100',perCallFeeAtoms:'0',openFeeAtoms:'12',ownerCloseFeeAtoms:'12',maturityCloseFeeAtoms:'0'},limits:{checkpoints:CHECKPOINT_LIMIT,userCheckpoints:USER_CHECKPOINT_LIMIT,channelLifetimeCalls:CHANNEL_LIFETIME_CALL_LIMIT,channelAcceptedCalls:usage.acceptedCalls,channelReservedCalls:usage.reservedCalls,channelAvailableCalls:Math.max(0,CHANNEL_LIFETIME_CALL_LIMIT-usage.acceptedCalls-usage.reservedCalls),dailyVisitors:2048,dailyHistoryReadsPerIP:20000,dailyHistoryReadsGlobal:100000},signatureAlgorithm:'ML-DSA-65',hashAlgorithm:'SHA-384',signer:{publicKey:this.key!.publicKey,address:this.key!.address},head:{height:meta.height,hash:meta.hash},genesisAt:meta.genesisAt,registeredAccounts:meta.accounts,consensus:'single-operator-devnet',mainnet:false,services:NATIVE_SERVICES,notice:'Self-issued native test asset. WORK redeems the specified deterministic computation; the spot pool uses test assets. No cash redemption, claimed dollar price, or independent-validator consensus. PQ signatures do not prove hosting, TLS, administration or implementation are quantum-safe.'};
  }
  private async append(transaction:any,signature:string|null,postings:Posting[],result:any,updates:Record<string,any>={},augment?:(receipt:any)=>Record<string,any>){
    const meta=(await this.ctx.storage.get<Meta>('meta'))!;
    const ownerRecovery=transaction.domain==='cinder.transaction.v1'&&transaction.actions?.length===1&&transaction.actions[0]?.type==='channel.close';
    if(meta.height>=CHECKPOINT_LIMIT||(transaction.domain==='cinder.transaction.v1'&&!ownerRecovery&&meta.height>=USER_CHECKPOINT_LIMIT))throw new NativeError('devnet_capacity','The development ledger has reached its entry capacity.',503);
    if(postings.reduce((sum,p)=>sum+BigInt(p.deltaAtoms),0n)!==0n)throw new Error('Native posting conservation failed');
    const transactionHash=txHash(transaction);const checkpoint={domain:'cinder.checkpoint.v1',chainId:NATIVE_CHAIN,height:meta.height+1,previousHash:meta.hash,transactionHash,postingsHash:nativeHash(nativeCanonical(postings)),resultHash:nativeHash(nativeCanonical(result)),timestamp:epoch(),mode:'single-operator-devnet'};
    if(transaction.domain==='cinder.transaction.v1'){
      const committedAt=Date.parse(checkpoint.timestamp);validateTransaction(transaction,committedAt);
      // A transition can pass before an awaited storage read crosses its signed deadline.
      for(const action of transaction.actions){
        if(['economy.addLiquidity','economy.removeLiquidity','economy.swap'].includes(action.type)&&Date.parse(action.deadline)<=committedAt)throw new NativeError('economy_expired','The market deadline elapsed before the transaction could be committed.',410);
        if(action.type==='channel.open'&&Date.parse(action.expiresAt)<=committedAt)throw new NativeError('invalid_channel_expiry','The channel expired before its reservation could be committed.',410);
      }
    }
    const checkpointSignature=nativeSign(checkpoint,this.key!.secretKey);const hash=nativeHash(nativeCanonical(checkpoint));
    const receipt={transaction,signature,checkpoint,checkpointSignature,postings,result};
    const next={...meta,height:checkpoint.height,hash};
    await this.ctx.storage.put({...updates,...(augment?augment(receipt):{}),meta:next,['transaction:'+transactionHash]:receipt,['block:'+String(next.height).padStart(10,'0')]:{txHash:transactionHash,hash,height:next.height,checkpoint,checkpointSignature}});
    return {txHash:transactionHash,receipt,head:{height:next.height,hash}};
  }
  async fetch(request:Request):Promise<Response>{
    let scheduled:{job:Job,input:string}|undefined;
    const response=await this.ctx.blockConcurrencyWhile(async()=>{
      try {
        await this.initialize();const url=new URL(request.url),path=url.pathname;const ip=request.headers.get('x-native-ip')||'localhost';
        const historyRead=path==='/api/native/export'||/^\/api\/native\/channels\/[a-f0-9]{96}\/journal$/.test(path);
        await this.quota(ip,['GET','HEAD'].includes(request.method)?(historyRead?'audit':'read'):path.endsWith('/accounts')?'register':path.endsWith('/media/upload')?'upload':path==='/api/native/channels/call'?'channel':'write');
        const mediaMatch=path.match(/^\/api\/native\/media\/([a-f0-9]{96})$/);
        if(mediaMatch&&['GET','HEAD'].includes(request.method))return await serveNativeMedia(this.ctx.storage,request,mediaMatch[1],Date.now());
        const trackMatch=path.match(/^\/api\/native\/music\/tracks\/([a-f0-9]{96})$/);
        if(trackMatch&&request.method==='GET'){const track=await this.ctx.storage.get('music:track:'+trackMatch[1]);return track?reply(track):reply({error:'track_missing',message:'Music track not found.'},404);}
        if(path==='/api/native/music/catalog'&&request.method==='GET'){
          const after=url.searchParams.get('after')||'';if(after&&!NATIVE_DIGEST.test(after))throw new NativeError('invalid_cursor','Use a track ID cursor.');
          const entries=await this.ctx.storage.list<any>({prefix:'music:track:',...(after?{startAfter:'music:track:'+after}:{}),limit:20});
          return reply({tracks:[...entries.values()].filter(t=>t.active),next:entries.size===20?[...entries.keys()].at(-1)!.slice('music:track:'.length):null});
        }
        if(path==='/api/native/economy'&&request.method==='GET'){
          const address=url.searchParams.get('address');if(address&&!NATIVE_ADDRESS.test(address))throw new NativeError('invalid_address','Use a native account address.');
          const state=await this.loadEconomy(address?[address]:[]);return reply({state,wallet:address?economyWallet(state,address):{workUnits:'0',lpUnits:'0'},offer:{priceAtoms:'100',unit:'one SHA-384 operation up to 4000 characters',resource:'WORK',expiry:null},info:economyInfo(state)});
        }
        const channelMatch=path.match(/^\/api\/native\/channels\/([a-f0-9]{96})(\/journal)?$/);
        if(channelMatch&&request.method==='GET'){
          await this.recoverJobs();const channel=await this.ctx.storage.get<NativeChannel>('channel:'+channelMatch[1]);
          if(!channel)throw new NativeError('channel_missing','Native channel not found.',404);
          if(!channelMatch[2])return reply(channel);
          const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new NativeError('invalid_cursor','Use a nonnegative sequence cursor.');
          const prefix='channel:journal:'+channel.channelId+':';const entries=await this.ctx.storage.list<any>({prefix,startAfter:prefix+String(after).padStart(5,'0'),limit:20});return reply({journal:[...entries.values()],next:entries.size?[...entries.values()].at(-1).journal.sequence:after,head:channel.journalHead});
        }
        if(path==='/api/native/info'&&request.method==='GET')return reply(await this.publicInfo());
        if(path==='/api/native/genesis'&&request.method==='GET')return reply(await this.ctx.storage.get('genesis'));
        const accountMatch=path.match(/^\/api\/native\/accounts\/(cin1[a-f0-9]{96})$/);
        if(accountMatch&&request.method==='GET'){const account=await this.ctx.storage.get(accountKey(accountMatch[1]));return account?reply(account):reply({error:'account_missing',message:'Native account not registered.'},404);}
        const txMatch=path.match(/^\/api\/native\/transactions\/([a-f0-9]{96})$/);
        if(txMatch&&request.method==='GET'){const receipt=await this.ctx.storage.get('transaction:'+txMatch[1]);return receipt?reply({txHash:txMatch[1],receipt}):reply({error:'transaction_missing',message:'Native transaction not found.'},404);}
        const jobMatch=path.match(/^\/api\/native\/jobs\/([a-f0-9]{96})$/);
        if(jobMatch&&request.method==='GET'){await this.recoverJobs();const job=await this.ctx.storage.get<Job>('job:'+jobMatch[1]);return job?reply(job):reply({error:'job_missing',message:'Native job not found.'},404);}
        if(path==='/api/native/export'&&request.method==='GET'){
          const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new NativeError('invalid_cursor','Use a nonnegative checkpoint cursor.');
          const blocks=await this.ctx.storage.list<any>({prefix:'block:',startAfter:'block:'+String(after).padStart(10,'0'),limit:20});
          const receipts:any[]=[];const publicKeys:Record<string,string>={};
          for(const block of blocks.values()){const receipt=await this.ctx.storage.get<any>('transaction:'+block.txHash);receipts.push(receipt);const tx=receipt.transaction;const addresses=new Set<string>([tx.sender,...receipt.postings.map((p:any)=>p.account),...(tx.actions||[]).flatMap((a:any)=>[a.to,...(a.recipients||[]).map((r:any)=>r.address)])]);for(const address of addresses){if(typeof address!=='string'||!NATIVE_ADDRESS.test(address)||publicKeys[address])continue;const account=await this.ctx.storage.get<NativeAccount>(accountKey(address));if(account?.publicKey)publicKeys[address]=account.publicKey;}}
          return reply({receipts,publicKeys,next:receipts.length?receipts.at(-1).checkpoint.height:after});
        }
        if(path==='/api/native/blocks'&&request.method==='GET'){
          const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new NativeError('invalid_cursor','Use a nonnegative block cursor.');
          const entries=await this.ctx.storage.list({prefix:'block:',startAfter:'block:'+String(after).padStart(10,'0'),limit:20});return reply({blocks:[...entries.values()],next:after+entries.size});
        }
        if(request.method!=='POST')throw new NativeError('not_found','Unknown native API route.',404);
        const body:any=await request.json();
        if(path==='/api/native/music/access')return reply(await this.musicAccess(body));
        if(path==='/api/native/channels/call')return reply(await this.channelCall(body));
        if(path==='/api/native/media/upload')return reply(await uploadNativeMedia(this.ctx.storage,body,Date.now()));
        if(path==='/api/native/accounts'){
          exact(body,['publicKey','proof']);const address=nativeAddress(body.publicKey);
          const authorization={domain:'cinder.account.v1',chainId:NATIVE_CHAIN,publicKey:body.publicKey};
          if(!nativeVerify(authorization,body.proof,body.publicKey))throw new NativeError('invalid_signature','Registration requires the corresponding ML-DSA private key.',401);
          const existing=await this.ctx.storage.get<NativeAccount>(accountKey(address));if(existing)return reply(existing);
          const meta=(await this.ctx.storage.get<Meta>('meta'))!;if(meta.accounts>=5000)throw new NativeError('account_capacity','Development account capacity reached.',429);
          const account:NativeAccount={address,publicKey:body.publicKey,balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:epoch()};
          await this.ctx.storage.put({[accountKey(address)]:account,meta:{...meta,accounts:meta.accounts+1}});return reply(account,201);
        }
        if(path==='/api/native/submit'){
          if(Object.keys(body).some(k=>!['transaction','signature','computeInput'].includes(k)))throw new NativeError('invalid_fields','Unknown submission field.');
          const tx=body.transaction;const hash=txHash(tx);
          // Idempotent delivery authenticates the original payload again, even after expiry.
          const saved=await this.ctx.storage.get<any>('transaction:'+hash);
          const sender=await this.ctx.storage.get<NativeAccount>(accountKey(tx?.sender));
          if(!sender?.publicKey||!nativeVerify(tx,body.signature,sender.publicKey))throw new NativeError('invalid_signature','Native authorization requires this sender’s ML-DSA signature.',401);
          if(saved){await this.recoverJobs();const job=await this.ctx.storage.get<Job>('job:'+hash);const refreshedSender=await this.ctx.storage.get<NativeAccount>(accountKey(tx.sender));return reply({txHash:hash,receipt:saved,account:refreshedSender,replayed:true,...(job?{job}:{})},job?.status==='pending'?202:200);}
          validateTransaction(tx,Date.now());
          const action=tx.actions[0],isMusic=typeof action?.type==='string'&&action.type.startsWith('music.'),isEconomy=typeof action?.type==='string'&&action.type.startsWith('economy.'),isChannel=typeof action?.type==='string'&&action.type.startsWith('channel.');
          const channel:NativeChannel|undefined=action.type==='channel.close'?await this.ctx.storage.get<NativeChannel>('channel:'+action.channelId):undefined;
          if(action.type==='channel.close'&&!channel)throw new NativeError('channel_missing','Native channel not found.',404);
          const music=isMusic?await this.loadMusic(tx):undefined,economy=isEconomy?await this.loadEconomy([tx.sender,...(typeof action.to==='string'?[action.to]:[])]):undefined;
          if(isMusic&&action.type==='music.publish'){
            const file:any=await this.ctx.storage.get('media:file:'+tx.sender+':'+action.audioHash);
            if(!file?.complete||file.mime!==action.mime||file.bytes!==action.bytes)throw new NativeError('audio_not_uploaded','Upload and verify the exact audio file before publishing.');
          }
          if(isMusic&&action.type==='music.listen'){
            const track=music!.tracks[action.trackId];const file:any=track&&await this.ctx.storage.get('media:file:'+track.owner+':'+track.audioHash);
            if(!file?.complete)throw new NativeError('audio_unavailable','This audio file is unavailable; no payment was made.',503);
          }
          const addresses=isMusic?musicAccounts(action,tx.sender,music):isEconomy?economyAccounts(action,tx.sender):isChannel?channelAccounts(tx,channel):touchedAccounts(tx);
          const values=await this.ctx.storage.get<NativeAccount>(addresses.map(accountKey));const snapshot:Record<string,NativeAccount>={};for(const account of values.values())snapshot[account.address]=account;
          if(isEconomy)for(const address of ['system:economy-pool','system:economy-provider'])snapshot[address]??={address,balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:epoch()};
          const transition:any=isMusic?applyMusic(snapshot,music,tx,Date.now()):isEconomy?applyEconomy(snapshot,economy,tx,Date.now()):isChannel?(action.type==='channel.open'?openChannel(snapshot,tx,Date.now()):closeChannel(snapshot,channel!,tx,Date.now())):applyNativeTransaction(snapshot,tx,Date.now());
          if(action.type==='economy.redeem'){
            if(typeof body.computeInput!=='string'||body.computeInput.length<1||body.computeInput.length>4000||nativeHash(body.computeInput)!==action.inputHash)throw new NativeError('input_mismatch','Resource redemption requires the exact authorized input.');
            transition.result.output=nativeHash(body.computeInput);transition.result.outputHash=nativeHash(transition.result.output);transition.result.model='sha384-v1';transition.result.evidence='deterministic public hash computation; independently recomputable';
          }
          let job:Job|undefined;
          if(transition.compute){
            const service=NATIVE_SERVICES.find(s=>s.id===transition.compute.service)!;
            if(typeof body.computeInput!=='string'||body.computeInput.length<1||body.computeInput.length>service.maxInputChars||nativeHash(body.computeInput)!==transition.compute.inputHash)throw new NativeError('input_mismatch','Compute input must match the signed hash and length limit.');
            if(service.id==='inference')await this.quota(ip,'inference');
            job={txHash:hash,sender:tx.sender,...transition.compute,status:'pending',startedAt:Date.now()};
            const pending:any[]=await this.ctx.storage.get('pending')||[];if(pending.length>=10)throw new NativeError('compute_busy','Native compute concurrency limit reached.',429);
            scheduled={job:job!,input:body.computeInput};
          }else if(body.computeInput!==undefined&&action.type!=='economy.redeem')throw new NativeError('unexpected_input','Only compute transactions accept computeInput.');
          const updates:Record<string,any>={};
          if(isMusic){const next=transition.state as MusicState;updates['music:count']=next.totalTracks;for(const [address,count] of Object.entries(next.ownerCounts))updates['music:owner:'+address]=count;for(const [id,track] of Object.entries(next.tracks))updates['music:track:'+id]=track;for(const [id,access] of Object.entries(next.listens))updates['music:listen:'+id]=access;
            if(action.type==='music.listen'){const track=next.tracks[action.trackId];const token=nativeBase64url(crypto.getRandomValues(new Uint8Array(32)));const expiresAt=Date.now()+3600000;updates['music:access:'+nativeHash(token)]={audioHash:track.audioHash,owner:track.owner,expiresAt,transactionHash:hash};updates['music:playback:'+hash]={playbackToken:token,playbackExpiresAt:expiresAt,audioHash:track.audioHash};}
          }
          if(isChannel){updates['channel:'+transition.channel.channelId]=transition.channel;const pending:any[]=await this.ctx.storage.get('pendingChannels')||[];
            if(action.type==='channel.open'){
              if(pending.length>=32)throw new NativeError('channel_capacity','At most 32 channels may reserve capacity concurrently.',429);
              const usage=await this.loadChannelUsage();
              if(usage.acceptedCalls+usage.reservedCalls+transition.channel.capacity>CHANNEL_LIFETIME_CALL_LIMIT)throw new NativeError('channel_lifetime_limit','This test network cannot reserve more channel journal capacity.',429);
              updates.channelUsage={...usage,reservedCalls:usage.reservedCalls+transition.channel.capacity};updates.pendingChannels=[...pending,{channelId:transition.channel.channelId,deadline:Date.parse(transition.channel.expiresAt)}];
            }else{updates.channelUsage=await this.releaseChannelCapacity(channel!);updates.pendingChannels=pending.filter(p=>p.channelId!==transition.channel.channelId);}
          }
          if(isEconomy){const {wallets,...global}=transition.state;updates['economy:global']=global;for(const [address,wallet] of Object.entries(wallets))updates['economy:wallet:'+address]=wallet;}
          for(const account of Object.values(transition.accounts) as NativeAccount[])updates[accountKey(account.address)]=account;
          if(job){updates['job:'+hash]=job;const pending:any[]=await this.ctx.storage.get('pending')||[];updates.pending=[...pending,{txHash:hash,deadline:job.startedAt+120000}];}
          // Arm recovery before committing any reservation. Failure leaves balances/nonce untouched.
          if(job||action.type==='channel.open'){const jobs=updates.pending||await this.ctx.storage.get<any[]>('pending')||[],channels=updates.pendingChannels||await this.ctx.storage.get<any[]>('pendingChannels')||[];await this.ctx.storage.setAlarm(Math.min(...[...jobs,...channels].map((p:any)=>p.deadline)));}
          const result=await this.append(tx,body.signature,transition.postings,transition.result,updates);
          if(action.type==='channel.close')await this.scheduleAlarm();
          return reply({...result,account:transition.accounts[tx.sender],...(job?{job}:{})},job?202:200);
        }
        throw new NativeError('not_found','Unknown native API route.',404);
      }catch(error){scheduled=undefined;return error instanceof NativeError?reply({error:error.code,message:error.message},error.status):reply({error:'invalid_native_request',message:'Native request failed validation or the development service is unavailable.'},400);}
    });
    if(scheduled){const {job,input}=scheduled;this.ctx.waitUntil(this.runCompute(job,input));}
    return response;
  }
  private async channelCall(body:any){
    exact(body,['message','signature','input']);const id=body.message?.channelId;
    if(typeof id!=='string'||!NATIVE_DIGEST.test(id))throw new NativeError('invalid_channel','Use a native channel ID.');
    await this.recoverJobs();const channel=await this.ctx.storage.get<NativeChannel>('channel:'+id);if(!channel)throw new NativeError('channel_missing','Native channel not found.',404);
    const messageHash=authenticateChannelCall(channel,body.message,body.signature,body.input),key='channel:journal:'+id+':'+String(body.message.sequence).padStart(5,'0');
    const saved:any=await this.ctx.storage.get(key);if(saved){if(saved.journal.messageHash!==messageHash)throw new NativeError('channel_sequence_used','This sequence authorized a different request.',409);return {...saved,replayed:true};}
    const snapshot=await this.accounts(channelCallAccounts(channel));const next=applyChannelCall(snapshot,channel,body.message,body.signature,body.input,Date.now());
    const usage=await this.loadChannelUsage();
    if(usage.acceptedCalls>=CHANNEL_LIFETIME_CALL_LIMIT||usage.reservedCalls<1)throw new NativeError('channel_lifetime_limit','The lifetime channel journal capacity is exhausted.',429);
    const response={journal:next.journal,result:next.result,channel:next.channel};await this.ctx.storage.put({channelUsage:{...usage,acceptedCalls:usage.acceptedCalls+1,reservedCalls:usage.reservedCalls-1},['channel:'+id]:next.channel,[key]:response});return response;
  }
  private async accounts(addresses:string[]){const values=await this.ctx.storage.get<NativeAccount>(addresses.map(accountKey));const snapshot:Record<string,NativeAccount>={};for(const account of values.values())snapshot[account.address]=account;return snapshot;}
  private async musicAccess(body:any){
    exact(body,['authorization','signature']);const a=body.authorization;exact(a,['domain','chainId','owner','transactionHash','nonce','validUntil']);
    if(a.domain!=='cinder.music.playback.v1'||a.chainId!==NATIVE_CHAIN||typeof a.owner!=='string'||!NATIVE_ADDRESS.test(a.owner)||typeof a.transactionHash!=='string'||!NATIVE_DIGEST.test(a.transactionHash)||typeof a.nonce!=='string'||!/^[a-f0-9]{32}$/.test(a.nonce))throw new NativeError('access_authorization','Invalid private playback authorization.');
    const until=typeof a.validUntil==='string'?Date.parse(a.validUntil):NaN;
    if(!Number.isFinite(until)||new Date(until).toISOString()!==a.validUntil||until<=Date.now()||until>Date.now()+300000)throw new NativeError('access_expired','Sign a fresh private playback request within five minutes.',401);
    const account=await this.ctx.storage.get<NativeAccount>(accountKey(a.owner));
    if(!account?.publicKey||!nativeVerify(a,body.signature,account.publicKey))throw new NativeError('access_signature','A fresh wallet signature is required to receive a private playback token.',401);
    const receipt:any=await this.ctx.storage.get('transaction:'+a.transactionHash);
    if(receipt?.transaction?.sender!==a.owner||receipt?.result?.action!=='music.listen')throw new NativeError('access_owner','Only the payer can recover this playback token.',403);
    const access:any=await this.ctx.storage.get('music:playback:'+a.transactionHash);
    if(!access||access.playbackExpiresAt<=Date.now())throw new NativeError('access_expired','This paid playback window has expired.',410);
    return access;
  }
  private async loadMusic(tx:any):Promise<MusicState>{
    const action=tx.actions[0];const state:MusicState={version:1,totalTracks:await this.ctx.storage.get<number>('music:count')||0,ownerCounts:{[tx.sender]:await this.ctx.storage.get<number>('music:owner:'+tx.sender)||0},tracks:{},listens:{}};
    if(typeof action.trackId==='string'&&NATIVE_DIGEST.test(action.trackId)){const track=await this.ctx.storage.get<any>('music:track:'+action.trackId);if(track)state.tracks[action.trackId]=track;}
    if(action.type==='music.listen'){const id=musicListenKey(tx.sender,action.listenId);const access=await this.ctx.storage.get<any>('music:listen:'+id);if(access)state.listens[id]=access;}
    return state;
  }
  private async loadEconomy(addresses:string[]){
    const global:any=await this.ctx.storage.get('economy:global');const wallets:Record<string,any>={};
    for(const address of new Set(addresses)){const wallet=await this.ctx.storage.get<any>('economy:wallet:'+address);if(wallet)wallets[address]=wallet;}
    return {...(global||{version:1,inventoryWork:'1000000',burnedWork:'0',walletWorkTotal:'0',walletLpTotal:'0',walletCount:0,pool:{cinderAtoms:'0',workUnits:'0',lpSupply:'0'}}),wallets};
  }
  private async runCompute(job:Job,input:string){
    let output:string|undefined;
    try {
      if(job.service==='hash')output=nativeHash(input);
      else {const response:any=await this.env.AI.run(NATIVE_SERVICES[1].model as any,{messages:[{role:'system',content:'Answer clearly and concisely in at most 100 words.'},{role:'user',content:input}],max_tokens:192,temperature:0.2});if(typeof response?.response!=='string'||!response.response.trim())throw new Error('No provider output');output=response.response;}
    }catch{}
    await this.ctx.blockConcurrencyWhile(async()=>{
      await this.initialize();const current=await this.ctx.storage.get<Job>('job:'+job.txHash);if(!current||current.status!=='pending')return;
      await this.completeJob(current,output);
    });
  }
  private async completeJob(job:Job,output?:string){
    const success=typeof output==='string'&&Date.now()<job.startedAt+120000;const target=success?'system:provider':job.sender;
    const escrow=(await this.ctx.storage.get<NativeAccount>(accountKey(job.escrow)))!;const recipient=(await this.ctx.storage.get<NativeAccount>(accountKey(target)))!;
    if(!escrow||!recipient||escrow.balanceAtoms!==job.amountAtoms)throw new Error('Escrow conservation failed');
    const postings=[{account:job.escrow,deltaAtoms:'-'+job.amountAtoms},{account:target,deltaAtoms:job.amountAtoms}];
    escrow.balanceAtoms='0';recipient.balanceAtoms=(BigInt(recipient.balanceAtoms)+BigInt(job.amountAtoms)).toString();
    const status=success?'complete':'failed';const transaction={domain:'cinder.compute-settlement.v1',chainId:NATIVE_CHAIN,requestTxHash:job.txHash,status,outputHash:success?nativeHash(output!):null,amountAtoms:job.amountAtoms};
    const result={status,requestTxHash:job.txHash,service:job.service,model:NATIVE_SERVICES.find(s=>s.id===job.service)!.model,refundAtoms:success?'0':job.amountAtoms,...(success?{output}:{reason:'provider_unavailable_or_reservation_timeout'}),evidence:'operator-signed provenance; not proof of correct inference'};
    const nextJob:Job={...job,status,refundAtoms:result.refundAtoms,...(success?{output}:{})};
    const pending:any[]=await this.ctx.storage.get('pending')||[];
    await this.append(transaction,null,postings,result,{[accountKey(job.escrow)]:escrow,[accountKey(target)]:recipient,pending:pending.filter(p=>p.txHash!==job.txHash)},receipt=>({['job:'+job.txHash]:{...nextJob,receipt}}));
    await this.scheduleAlarm();
  }
  private async scheduleAlarm(){const pending:any[]=await this.ctx.storage.get('pending')||[],channels:any[]=await this.ctx.storage.get('pendingChannels')||[];const all=[...pending,...channels];if(all.length)await this.ctx.storage.setAlarm(Math.min(...all.map(p=>p.deadline)));else await this.ctx.storage.deleteAlarm();}
  private async recoverJobs(){
    const pending:any[]=await this.ctx.storage.get('pending')||[];
    for(const entry of pending){if(entry.deadline>Date.now())continue;const job=await this.ctx.storage.get<Job>('job:'+entry.txHash);if(job?.status==='pending')await this.completeJob(job);}
    const pendingChannels:any[]=await this.ctx.storage.get('pendingChannels')||[];
    for(const entry of pendingChannels){
      if(entry.deadline>Date.now())continue;const channel=await this.ctx.storage.get<NativeChannel>('channel:'+entry.channelId);if(!channel||channel.status!=='open')continue;
      const transition=expireChannel(await this.accounts([channel.owner,channel.escrow,'system:provider']),channel,Date.now());
      const updates:Record<string,any>={channelUsage:await this.releaseChannelCapacity(channel),['channel:'+channel.channelId]:transition.channel,pendingChannels:(await this.ctx.storage.get<any[]>('pendingChannels')||[]).filter(p=>p.channelId!==channel.channelId)};
      for(const account of Object.values(transition.accounts))updates[accountKey(account.address)]=account;
      await this.append(transition.transaction,null,transition.postings,transition.result,updates);
    }
    await this.scheduleAlarm();
  }
  async alarm(){await this.ctx.blockConcurrencyWhile(async()=>{await this.initialize();await this.recoverJobs();});}
}
