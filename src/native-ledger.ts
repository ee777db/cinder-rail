import {DurableObject} from 'cloudflare:workers';
import {nativeGenerateKey,nativeVerify,nativeSign,nativeHash,nativeAddress,nativeCanonical,type NativeKey} from './native-crypto';
import {NATIVE_CHAIN,NATIVE_SUPPLY,NATIVE_FAUCET,NATIVE_SERVICES,NATIVE_ADDRESS,NATIVE_DIGEST,NativeError,exact,validateTransaction,applyNativeTransaction,touchedAccounts,txHash,type NativeAccount,type Posting} from './native-core';
interface NativeEnv {NATIVE:DurableObjectNamespace<NativeLedger>;AI:Ai;}
const reply=(body:any,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const accountKey=(address:string)=>'account:'+address;
const epoch=()=>new Date().toISOString();
interface Meta {height:number;hash:string;accounts:number;supplyAtoms:string;genesisAt:string;}
interface Job {txHash:string;sender:string;service:string;amountAtoms:string;escrow:string;status:'pending'|'complete'|'failed';startedAt:number;output?:string;receipt?:any;refundAtoms?:string;}
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
    response=await env.NATIVE.get(env.NATIVE.idFromName(NATIVE_CHAIN)).fetch(url.toString(),{method:request.method,headers:{'content-type':'application/json','x-native-ip':request.headers.get('cf-connecting-ip')||'localhost'},body});
  }
  const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin','*');headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');headers.set('Access-Control-Allow-Headers','content-type');headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
}
export class NativeLedger extends DurableObject<NativeEnv> {
  private key?:NativeKey;
  private async initialize(){
    if(!this.key){this.key=await this.ctx.storage.get<NativeKey>('issuer');if(!this.key){this.key=nativeGenerateKey();await this.ctx.storage.put('issuer',this.key);}}
    if(!await this.ctx.storage.get('meta')){
      const genesisAt=epoch();const genesis={domain:'cinder.genesis.v1',chainId:NATIVE_CHAIN,symbol:'CINDER',decimals:6,supplyAtoms:NATIVE_SUPPLY,allocation:'system:reserve',operatorPublicKey:this.key.publicKey,createdAt:genesisAt,consensus:'single-operator-devnet'};
      const hash=nativeHash(nativeCanonical(genesis));
      const genesisRecord={genesis,signature:nativeSign(genesis,this.key.secretKey),hash};
      const meta:Meta={height:0,hash,accounts:0,supplyAtoms:NATIVE_SUPPLY,genesisAt};
      await this.ctx.storage.put({'meta':meta,'genesis':genesisRecord,[accountKey('system:reserve')]:{address:'system:reserve',balanceAtoms:NATIVE_SUPPLY,nonce:0,claimedFaucet:false,createdAt:genesisAt},[accountKey('system:fees')]:{address:'system:fees',balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:genesisAt},[accountKey('system:provider')]:{address:'system:provider',balanceAtoms:'0',nonce:0,claimedFaucet:false,createdAt:genesisAt}});
    }
  }
  private async quota(ip:string,kind:'read'|'write'|'register'|'inference'){
    const day=epoch().slice(0,10);let q:any=await this.ctx.storage.get('quota');
    if(!q||q.day!==day)q={day,salt:crypto.randomUUID(),reads:0,writes:0,registrations:0,inferences:0,ips:{}};
    const key=nativeHash(q.salt+ip);let client=q.ips[key];
    if(!client){if(Object.keys(q.ips).length>=2048)throw new NativeError('daily_limit','Daily devnet visitor capacity reached.',429);client={read:0,write:0,register:0};}
    if(kind==='read'){if(client.read>=1800||q.reads>=50000)throw new NativeError('read_limit','Daily devnet read allowance reached.',429);client.read++;q.reads++;}
    else if(kind==='inference'){if(q.inferences>=30)throw new NativeError('inference_limit','The native devnet daily inference budget is exhausted.',429);q.inferences++;}
    else {if(client.write>=300||q.writes>=10000)throw new NativeError('write_limit','Daily devnet write allowance reached.',429);client.write++;q.writes++;if(kind==='register'){if(client.register>=20||q.registrations>=500)throw new NativeError('registration_limit','Daily native account registration allowance reached.',429);client.register++;q.registrations++;}}
    q.ips[key]=client;await this.ctx.storage.put('quota',q);
  }
  private async publicInfo(){
    const meta=(await this.ctx.storage.get<Meta>('meta'))!;const reserve=(await this.ctx.storage.get<NativeAccount>(accountKey('system:reserve')))!;
    return {chainId:NATIVE_CHAIN,symbol:'CINDER',decimals:6,assetId:NATIVE_CHAIN+'/native',supplyAtoms:NATIVE_SUPPLY,reserveAtoms:reserve.balanceAtoms,circulatingTestAtoms:(BigInt(NATIVE_SUPPLY)-BigInt(reserve.balanceAtoms)).toString(),faucetAtoms:NATIVE_FAUCET,feeBaseAtoms:'10',feePerActionAtoms:'2',maxBatchActions:16,signatureAlgorithm:'ML-DSA-65',hashAlgorithm:'SHA-384',signer:{publicKey:this.key!.publicKey,address:this.key!.address},head:{height:meta.height,hash:meta.hash},genesisAt:meta.genesisAt,registeredAccounts:meta.accounts,consensus:'single-operator-devnet',mainnet:false,services:NATIVE_SERVICES,notice:'Own native devnet asset. No redemption, exchange price, public-validator consensus or economic value. PQ signatures do not prove hosting, TLS, administration or implementation are quantum-safe.'};
  }
  private async append(transaction:any,signature:string|null,postings:Posting[],result:any,updates:Record<string,any>={},augment?:(receipt:any)=>Record<string,any>){
    const meta=(await this.ctx.storage.get<Meta>('meta'))!;
    if(meta.height>=100000||(transaction.domain==='cinder.transaction.v1'&&meta.height>=99980))throw new NativeError('devnet_capacity','The development ledger has reached its entry capacity.',503);
    if(postings.reduce((sum,p)=>sum+BigInt(p.deltaAtoms),0n)!==0n)throw new Error('Native posting conservation failed');
    const transactionHash=txHash(transaction);const checkpoint={domain:'cinder.checkpoint.v1',chainId:NATIVE_CHAIN,height:meta.height+1,previousHash:meta.hash,transactionHash,postingsHash:nativeHash(nativeCanonical(postings)),resultHash:nativeHash(nativeCanonical(result)),timestamp:epoch(),mode:'single-operator-devnet'};
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
        await this.quota(ip,request.method==='GET'?'read':path.endsWith('/accounts')?'register':'write');
        if(path==='/api/native/info'&&request.method==='GET')return reply(await this.publicInfo());
        if(path==='/api/native/genesis'&&request.method==='GET')return reply(await this.ctx.storage.get('genesis'));
        const accountMatch=path.match(/^\/api\/native\/accounts\/(cin1[a-f0-9]{96})$/);
        if(accountMatch&&request.method==='GET'){const account=await this.ctx.storage.get(accountKey(accountMatch[1]));return account?reply(account):reply({error:'account_missing',message:'Native account not registered.'},404);}
        const txMatch=path.match(/^\/api\/native\/transactions\/([a-f0-9]{96})$/);
        if(txMatch&&request.method==='GET'){const receipt=await this.ctx.storage.get('transaction:'+txMatch[1]);return receipt?reply({txHash:txMatch[1],receipt}):reply({error:'transaction_missing',message:'Native transaction not found.'},404);}
        const jobMatch=path.match(/^\/api\/native\/jobs\/([a-f0-9]{96})$/);
        if(jobMatch&&request.method==='GET'){await this.recoverJobs();const job=await this.ctx.storage.get<Job>('job:'+jobMatch[1]);return job?reply(job):reply({error:'job_missing',message:'Native job not found.'},404);}
        if(path==='/api/native/blocks'&&request.method==='GET'){
          const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new NativeError('invalid_cursor','Use a nonnegative block cursor.');
          const entries=await this.ctx.storage.list({prefix:'block:',startAfter:'block:'+String(after).padStart(10,'0'),limit:20});return reply({blocks:[...entries.values()],next:after+entries.size});
        }
        if(request.method!=='POST')throw new NativeError('not_found','Unknown native API route.',404);
        const body:any=await request.json();
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
          const keys=touchedAccounts(tx).map(accountKey);const values=await this.ctx.storage.get<NativeAccount>(keys);const snapshot:Record<string,NativeAccount>={};for(const account of values.values())snapshot[account.address]=account;
          const transition=applyNativeTransaction(snapshot,tx,Date.now());
          let job:Job|undefined;
          if(transition.compute){
            const service=NATIVE_SERVICES.find(s=>s.id===transition.compute.service)!;
            if(typeof body.computeInput!=='string'||body.computeInput.length<1||body.computeInput.length>service.maxInputChars||nativeHash(body.computeInput)!==transition.compute.inputHash)throw new NativeError('input_mismatch','Compute input must match the signed hash and length limit.');
            if(service.id==='inference')await this.quota(ip,'inference');
            job={txHash:hash,sender:tx.sender,...transition.compute,status:'pending',startedAt:Date.now()};
            const pending:any[]=await this.ctx.storage.get('pending')||[];if(pending.length>=10)throw new NativeError('compute_busy','Native compute concurrency limit reached.',429);
            scheduled={job:job!,input:body.computeInput};
          }else if(body.computeInput!==undefined)throw new NativeError('unexpected_input','Only compute transactions accept computeInput.');
          const updates:Record<string,any>={};for(const account of Object.values(transition.accounts))updates[accountKey(account.address)]=account;
          if(job){updates['job:'+hash]=job;const pending:any[]=await this.ctx.storage.get('pending')||[];updates.pending=[...pending,{txHash:hash,deadline:job.startedAt+120000}];}
          // Arm recovery before committing any reservation. Failure leaves balances/nonce untouched.
          if(job)await this.ctx.storage.setAlarm(Math.min(...updates.pending.map((p:any)=>p.deadline)));
          const result=await this.append(tx,body.signature,transition.postings,transition.result,updates);
          return reply({...result,account:transition.accounts[tx.sender],...(job?{job}:{})},job?202:200);
        }
        throw new NativeError('not_found','Unknown native API route.',404);
      }catch(error){scheduled=undefined;return error instanceof NativeError?reply({error:error.code,message:error.message},error.status):reply({error:'invalid_native_request',message:'Native request failed validation or the development service is unavailable.'},400);}
    });
    if(scheduled){const {job,input}=scheduled;this.ctx.waitUntil(this.runCompute(job,input));}
    return response;
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
  private async scheduleAlarm(){const pending:any[]=await this.ctx.storage.get('pending')||[];if(pending.length)await this.ctx.storage.setAlarm(Math.min(...pending.map(p=>p.deadline)));else await this.ctx.storage.deleteAlarm();}
  private async recoverJobs(){
    const pending:any[]=await this.ctx.storage.get('pending')||[];
    for(const entry of pending){if(entry.deadline>Date.now())continue;const job=await this.ctx.storage.get<Job>('job:'+entry.txHash);if(job?.status==='pending')await this.completeJob(job);}
    await this.scheduleAlarm();
  }
  async alarm(){await this.ctx.blockConcurrencyWhile(async()=>{await this.initialize();await this.recoverJobs();});}
}
