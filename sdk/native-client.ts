import {nativeGenerateKey,nativeSign,nativeVerify,nativeHash,nativeCanonical,nativeBase64url,nativeAddress,type NativeKey} from '../src/native-crypto.ts';
import {NATIVE_SUPPLY,NATIVE_SERVICES,applyNativeTransaction,validateTransaction,exact,type NativeAccount} from '../src/native-core.ts';
import {openChannel as replayChannelOpen,channelMessageHash,type NativeChannel} from '../src/native-channel.ts';
export {nativeGenerateKey,nativeHash,nativeCanonical,nativeSign,nativeVerify};
const sdkEqual=(actual:any,expected:any,message:string)=>{if(nativeCanonical(actual)!==nativeCanonical(expected))throw new Error(message);};
const sdkDigest=(value:any)=>{if(typeof value!=='string'||!/^[a-f0-9]{96}$/.test(value))throw new Error('Invalid native digest');return value;};
const sdkEpoch=(value:any)=>{const time=typeof value==='string'?Date.parse(value):NaN;if(!Number.isFinite(time)||new Date(time).toISOString()!==value)throw new Error('Invalid native timestamp');return time;};
export class CinderNativeClient {
  private info:any;
  private pendingListens=new Map<string,{listenId:string,envelope:any,paid?:any}>();
  private listenFlights=new Map<string,{cap:string,listenId?:string,promise:Promise<any>}>();
  private channelTerms=new Map<string,{opening:NativeChannel,journals:Map<number,string>}>();
  private pendingChannelOpens=new Map<string,{envelope:any,sessionKey:NativeKey,capacity:number,lifetimeMs:number}>();
  private channelOpenFlights=new Map<string,{capacity:number,lifetimeMs:number,promise:Promise<any>}>();
  constructor(public baseUrl='https://cinder-rail.ee777db.workers.dev',public signerPublicKey?:string){this.baseUrl=this.baseUrl.replace(/\/$/,'');}
  private async request(path:string,body?:any){const response=await fetch(this.baseUrl+'/api/native'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data:any=await response.json();if(!response.ok)throw Object.assign(new Error(data.message||'Cinder request failed'),{status:response.status,code:data.error});return data;}
  async connect(){this.info=await this.request('/info');if(this.info.chainId!=='cinder-devnet-1'||this.info.signatureAlgorithm!=='ML-DSA-65')throw new Error('Unsupported native network');if(this.signerPublicKey&&this.signerPublicKey!==this.info.signer.publicKey)throw new Error('Pinned operator key mismatch');this.signerPublicKey??=this.info.signer.publicKey;return this.info;}
  async register(key:NativeKey){if(!this.info)await this.connect();const authorization={domain:'cinder.account.v1',chainId:this.info.chainId,publicKey:key.publicKey};return this.request('/accounts',{publicKey:key.publicKey,proof:nativeSign(authorization,key.secretKey)});}
  async createWallet(){const key=nativeGenerateKey();await this.register(key);return key;}
  account(address:string){return this.request('/accounts/'+encodeURIComponent(address));}
  verifyReceipt(receipt:any,expectedTransaction?:any){
    if(!this.signerPublicKey||receipt?.checkpoint?.domain!=='cinder.checkpoint.v1'||receipt.checkpoint.chainId!==this.info?.chainId||!nativeVerify(receipt.checkpoint,receipt.checkpointSignature,this.signerPublicKey))throw new Error('Invalid native checkpoint signature');
    const {checkpoint,transaction,postings,result}=receipt;
    if(checkpoint.transactionHash!==nativeHash(nativeCanonical(transaction))||checkpoint.postingsHash!==nativeHash(nativeCanonical(postings))||checkpoint.resultHash!==nativeHash(nativeCanonical(result)))throw new Error('Receipt content hash mismatch');
    if(expectedTransaction){
      if(nativeCanonical(transaction)!==nativeCanonical(expectedTransaction))throw new Error('Receipt has another transaction');
      const debit=postings.filter((p:any)=>p.account===expectedTransaction.sender&&BigInt(p.deltaAtoms)<0n).reduce((n:bigint,p:any)=>n-BigInt(p.deltaAtoms),0n);
      if(debit>BigInt(expectedTransaction.maxDebitAtoms))throw new Error('Receipt exceeds the authorized gross spending cap');
    }
    if(postings.reduce((sum:bigint,p:any)=>sum+BigInt(p.deltaAtoms),0n)!==0n)throw new Error('Receipt violates posting conservation');
    return true;
  }
  async authorize(key:NativeKey,actions:any[],maxDebitAtoms:string){
    if(!this.info)await this.connect();const current=await this.account(key.address);
    let debit=actions.length===1&&actions[0].type==='faucet'?0n:10n+2n*BigInt(actions.length);
    for(const a of actions){if(a.type==='transfer'||a.type==='split')debit+=BigInt(a.amountAtoms);else if(a.type==='compute'){const service=this.info.services.find((s:any)=>s.id===a.service);if(!service)throw new Error('Unknown compute service');debit+=BigInt(service.amountAtoms);}else if(a.type==='music.listen'){const track=await this.track(a.trackId);debit+=BigInt(track.priceAtoms);}else if(a.type==='economy.buy')debit+=BigInt(a.maxCinderAtoms);else if(a.type==='economy.addLiquidity')debit+=BigInt(a.maxCinderAtoms);else if(a.type==='economy.swap'&&a.assetIn==='CINDER')debit+=BigInt(a.amountIn);else if(a.type==='channel.open')debit+=BigInt(a.capacity)*100n;else if(!['faucet','music.publish','music.unpublish','economy.transfer','economy.redeem','economy.removeLiquidity','economy.swap','channel.close'].includes(a.type))throw new Error('Unknown action');}
    if(debit>BigInt(maxDebitAtoms))throw new Error('Native debit exceeds the local spending cap');
    const transaction={domain:'cinder.transaction.v1',chainId:this.info.chainId,sender:key.address,nonce:current.nonce+1,validUntil:new Date(Date.now()+120000).toISOString(),maxDebitAtoms,actions};
    return {transaction,signature:nativeSign(transaction,key.secretKey)};
  }
  /** Save this signed envelope while a network result is uncertain; retry it, never a new nonce. */
  async submit(envelope:any,computeInput?:string){const result=await this.request('/submit',{...envelope,...(computeInput!==undefined?{computeInput}:{})});if(result.txHash!==nativeHash(nativeCanonical(envelope.transaction)))throw new Error('Transaction identifier mismatch');if(result.receipt.signature!==envelope.signature){const {account}=await this.nativeRequestProof(result.txHash,result.receipt);if(!nativeVerify(envelope.transaction,envelope.signature,account.publicKey))throw new Error('Invalid resubmitted authorization');}this.verifyReceipt(result.receipt,envelope.transaction);return result;}
  async claimFaucet(key:NativeKey){return this.submit(await this.authorize(key,[{type:'faucet'}],'0'));}
  async transfer(key:NativeKey,to:string,amountAtoms:string,maxDebitAtoms:string){return this.submit(await this.authorize(key,[{type:'transfer',to,amountAtoms}],maxDebitAtoms));}
  async splitUsage(key:NativeKey,app:'music'|'agent'|'trade',recipients:Array<{address:string,bps:number}>,amountAtoms:string,reference:string,units:number,maxDebitAtoms:string){return this.submit(await this.authorize(key,[{type:'split',app,recipients,amountAtoms,referenceHash:nativeHash(reference),units}],maxDebitAtoms));}
  async compute(key:NativeKey,service:'hash'|'inference',input:string,maxDebitAtoms:string){const envelope=await this.authorize(key,[{type:'compute',service,inputHash:nativeHash(input)}],maxDebitAtoms);return this.submit(envelope,input);}
  async job(hash:string){
    sdkDigest(hash);if(!this.info)await this.connect();
    const job=await this.request('/jobs/'+hash);
    if(!job||!['pending','complete','failed'].includes(job.status))throw new Error('Invalid compute job status');
    if(job.status!=='pending'&&!job.receipt)throw new Error('Terminal compute job requires a settlement receipt');
    const {receipt:reservation,account}=await this.nativeRequestProof(hash);
    const tx=reservation.transaction,action=tx.actions[0],service=NATIVE_SERVICES.find(s=>s.id===action?.service);
    if(tx.actions.length!==1||action?.type!=='compute'||!service)throw new Error('Job is not a compute reservation');
    const transition=applyNativeTransaction(this.validationSnapshot(tx,account.publicKey),tx,sdkEpoch(reservation.checkpoint.timestamp));
    sdkEqual(reservation.result,transition.result,'Compute reservation result mismatch');
    sdkEqual(reservation.postings,transition.postings,'Compute reservation postings mismatch');
    const base={txHash:hash,sender:tx.sender,...transition.compute,status:job.status,startedAt:job.startedAt};
    if(!Number.isSafeInteger(job.startedAt)||job.startedAt<0||job.startedAt>sdkEpoch(reservation.checkpoint.timestamp)||job.startedAt<Date.parse(tx.validUntil)-300000)throw new Error('Invalid compute job start time');
    if(job.status==='pending'){sdkEqual(job,base,'Pending compute job contains unauthenticated fields');return job;}
    this.verifyReceipt(job.receipt);
    const complete=job.status==='complete',refundAtoms=complete?'0':service.amountAtoms;
    if(complete&&typeof job.output!=='string')throw new Error('Complete compute job requires output');
    if(complete&&service.id==='hash'&&job.output!==action.inputHash)throw new Error('Compute digest does not match the authorized input');
    const settlement={domain:'cinder.compute-settlement.v1',chainId:this.info.chainId,requestTxHash:hash,status:job.status,outputHash:complete?nativeHash(job.output):null,amountAtoms:service.amountAtoms};
    const result={status:job.status,requestTxHash:hash,service:service.id,model:service.model,refundAtoms,...(complete?{output:job.output}:{reason:'provider_unavailable_or_reservation_timeout'}),evidence:'operator-signed provenance; not proof of correct inference'};
    sdkEqual(job.receipt.transaction,settlement,'Compute settlement transaction mismatch');
    sdkEqual(job.receipt.result,result,'Compute settlement result mismatch');
    sdkEqual(job.receipt.postings,[{account:transition.compute!.escrow,deltaAtoms:'-'+service.amountAtoms},{account:complete?'system:provider':tx.sender,deltaAtoms:service.amountAtoms}],'Compute settlement postings mismatch');
    if(job.receipt.signature!==null||sdkEpoch(job.receipt.checkpoint.timestamp)<sdkEpoch(reservation.checkpoint.timestamp))throw new Error('Invalid compute settlement ordering');
    sdkEqual(job,{...base,refundAtoms,...(complete?{output:job.output}:{}),receipt:job.receipt},'Compute job fields disagree with its signed settlement');
    return job;
  }
  /** Every app action uses the same signer, integer debit ceiling, nonce and receipt validation. */
  async transact(key:NativeKey,action:any,maxDebitAtoms:string,computeInput?:string){return this.submit(await this.authorize(key,[action],maxDebitAtoms),computeInput);}
  economy(address?:string){return this.request('/economy'+(address?'?address='+encodeURIComponent(address):''));}
  catalog(after?:string){return this.request('/music/catalog'+(after?'?after='+encodeURIComponent(after):''));}
  track(id:string){return this.request('/music/tracks/'+encodeURIComponent(id));}
  async listen(key:NativeKey,trackId:string,maxDebitAtoms:string,listenId?:string){
    const id=key.address+':'+trackId,flight=this.listenFlights.get(id);
    if(flight){if(flight.cap!==maxDebitAtoms||flight.listenId!==listenId)throw new Error('A playback purchase with different terms is already in progress');return flight.promise;}
    const promise=this.performListen(key,trackId,maxDebitAtoms,listenId);this.listenFlights.set(id,{cap:maxDebitAtoms,listenId,promise});
    try{return await promise;}finally{this.listenFlights.delete(id);}
  }
  private async performListen(key:NativeKey,trackId:string,maxDebitAtoms:string,listenId?:string){
    const id=key.address+':'+trackId;let pending=this.pendingListens.get(id);
    if(pending&&((listenId&&listenId!==pending.listenId)||BigInt(pending.envelope.transaction.maxDebitAtoms)>BigInt(maxDebitAtoms)))throw new Error('Recover the pending playback payment before authorizing different terms');
    if(!pending){listenId??=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');pending={listenId,envelope:await this.authorize(key,[{type:'music.listen',trackId,listenId}],maxDebitAtoms)};this.pendingListens.set(id,pending);}
    try {
      pending.paid??=await this.submit(pending.envelope);
      const access=await this.musicAccess(key,pending.paid.txHash),result={...pending.paid,...access,listenId:pending.listenId};
      this.pendingListens.delete(id);return result;
    }catch(error:any){
      if(!pending.paid&&['expired','wrong_nonce','spending_cap','insufficient_balance','track_missing','track_inactive','devnet_capacity'].includes(error?.code))this.pendingListens.delete(id);
      if(pending.paid&&error?.code==='access_expired'&&error?.status===410&&Date.parse(pending.paid.receipt.result?.access?.createdAt)+3600000<=Date.now())this.pendingListens.delete(id);
      throw Object.assign(error instanceof Error?error:new Error('Playback recovery required'),{pendingTransactionHash:nativeHash(nativeCanonical(pending.envelope.transaction)),listenId:pending.listenId,authorization:pending.envelope,...(pending.paid?{paid:pending.paid}:{})});
    }
  }
  async musicAccess(key:NativeKey,transactionHash:string){if(!this.info)await this.connect();const authorization={domain:'cinder.music.playback.v1',chainId:this.info.chainId,owner:key.address,transactionHash,nonce:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),validUntil:new Date(Date.now()+120000).toISOString()};return this.request('/music/access',{authorization,signature:nativeSign(authorization,key.secretKey)});}
  playbackUrl(hash:string,token:string){return this.baseUrl+'/api/native/media/'+encodeURIComponent(hash)+'?token='+encodeURIComponent(token);}
  async uploadAudio(key:NativeKey,bytes:Uint8Array,mime:string,onProgress?:(completed:number,total:number)=>void){
    if(!this.info)await this.connect();
    if(bytes.byteLength<12||bytes.byteLength>4*1024*1024||!['audio/mpeg','audio/wav','audio/ogg'].includes(mime))throw new Error('Use MPEG, WAV or Ogg audio up to 4 MiB');
    const hash=async(data:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-384',new Uint8Array(data))),b=>b.toString(16).padStart(2,'0')).join('');
    const audioHash=await hash(bytes),uploadId=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),chunks=Math.ceil(bytes.length/24576);
    for(let index=0;index<chunks;index++){
      const chunk=bytes.slice(index*24576,(index+1)*24576),authorization={domain:'cinder.media-chunk.v1',chainId:this.info.chainId,owner:key.address,uploadId,audioHash,mime,bytes:bytes.length,chunks,index,chunkHash:await hash(chunk),validUntil:new Date(Date.now()+1800000).toISOString()};
      const payload={authorization,signature:nativeSign(authorization,key.secretKey),data:nativeBase64url(chunk)};
      // Identical signed chunk delivery is idempotent. A retry never replaces accepted bytes.
      let response:any;for(let attempt=0;attempt<3;attempt++){try{response=await this.request('/media/upload',payload);break;}catch(error:any){if(attempt===2||(error.status&&error.status<500))throw error;}}
      if(response.audioHash!==audioHash||response.next!==index+1)throw new Error('Unexpected signed audio upload progress');
      if(index===chunks-1&&!response.complete)throw new Error('Audio commitment was not finalized');onProgress?.(index+1,chunks);
    }
    return {audioHash,mime,bytes:bytes.length,uploadId};
  }

  /** A synthetic funded snapshot validates transition arithmetic, not historical balances. */
  private validationSnapshot(tx:any,publicKey:string):Record<string,NativeAccount>{
    const base={nonce:0,claimedFaucet:false,createdAt:new Date(0).toISOString()};
    return Object.fromEntries([tx.sender,'system:reserve','system:fees','system:provider'].map(address=>({address,...base,balanceAtoms:address===tx.sender?NATIVE_SUPPLY:'0',...(address===tx.sender?{publicKey,nonce:tx.nonce-1}:{})})).map(account=>[account.address,account]));
  }
  private async nativeRequestProof(hash:string,supplied?:any){
    sdkDigest(hash);if(!this.info)await this.connect();
    const response=supplied?{txHash:hash,receipt:supplied}:await this.request('/transactions/'+hash);
    if(response.txHash!==hash||response.receipt?.checkpoint?.transactionHash!==hash)throw new Error('Native request identifier mismatch');
    const receipt=response.receipt;this.verifyReceipt(receipt,receipt.transaction);
    validateTransaction(receipt.transaction,sdkEpoch(receipt.checkpoint.timestamp));
    const account=await this.account(receipt.transaction.sender);
    if(account.address!==receipt.transaction.sender||nativeAddress(account.publicKey)!==account.address||!nativeVerify(receipt.transaction,receipt.signature,account.publicKey))throw new Error('Invalid native request authorization');
    return {receipt,account};
  }
  private async trustedChannel(id:string,supplied?:any){
    sdkDigest(id);const cached=this.channelTerms.get(id);if(cached)return cached;
    const {receipt,account}=await this.nativeRequestProof(id,supplied),tx=receipt.transaction;
    if(tx.actions.length!==1||tx.actions[0]?.type!=='channel.open')throw new Error('Channel identifier does not name an opening');
    const openedAt=sdkEpoch(receipt.result?.channel?.openedAt);
    if(openedAt>sdkEpoch(receipt.checkpoint.timestamp))throw new Error('Channel opened after its checkpoint');
    const expected=replayChannelOpen(this.validationSnapshot(tx,account.publicKey),tx,openedAt);
    sdkEqual(receipt.result,expected.result,'Channel opening terms mismatch');sdkEqual(receipt.postings,expected.postings,'Channel opening postings mismatch');
    const terms={opening:structuredClone(expected.channel),journals:new Map<number,string>()};this.channelTerms.set(id,terms);return terms;
  }
  private checkedChannel(state:any,opening:NativeChannel){
    if(!state||!Number.isSafeInteger(state.sequence)||state.sequence<0||state.sequence>opening.capacity||!['open','closed'].includes(state.status))throw new Error('Invalid channel accounting state');
    const spent=BigInt(state.sequence)*100n,head=sdkDigest(state.journalHead);
    if(state.sequence===0&&head!==opening.journalHead)throw new Error('Channel genesis journal mismatch');
    const expected:any={...opening,sequence:state.sequence,spentAtoms:spent.toString(),remainingAtoms:(BigInt(opening.depositAtoms)-spent).toString(),journalHead:head,status:state.status};
    if(state.status==='closed'){
      const closed=sdkEpoch(state.closedAt);if(closed<sdkEpoch(opening.openedAt)||!['owner','expired'].includes(state.closeReason)||(state.closeReason==='expired'&&closed<sdkEpoch(opening.expiresAt)))throw new Error('Invalid channel closing state');
      expected.closedAt=state.closedAt;expected.closeReason=state.closeReason;
    }
    sdkEqual(state,expected,'Channel state differs from its authorized terms');return state;
  }
  private checkedChannelCall(response:any,terms:{opening:NativeChannel,journals:Map<number,string>},expectedMessage?:any,previousHash?:string){
    if(!response||!response.journal||!response.result||!response.channel||Object.keys(response).some(k=>!['journal','result','channel','replayed'].includes(k))||('replayed'in response&&response.replayed!==true))throw new Error('Invalid channel response');
    const journal=response.journal,message=journal.authorization,opening=terms.opening,messageHash=channelMessageHash(message),sequence=message.sequence;
    if(expectedMessage)sdkEqual(message,expectedMessage,'Channel response has another authorization');
    if(message.channelId!==opening.channelId||sequence>opening.capacity||!nativeVerify(message,journal.signature,opening.sessionPublicKey))throw new Error('Invalid channel session authorization');
    const recordedAt=sdkEpoch(journal.recordedAt);
    if(recordedAt<sdkEpoch(opening.openedAt)||recordedAt>=sdkEpoch(opening.expiresAt))throw new Error('Channel call was recorded outside its lifetime');
    const linked=sequence===1?opening.journalHead:terms.journals.get(sequence-1);
    sdkDigest(journal.previousHash);if((previousHash!==undefined&&journal.previousHash!==sdkDigest(previousHash))||(linked!==undefined&&journal.previousHash!==linked))throw new Error('Channel journal predecessor mismatch');
    const expectedJournal={domain:'cinder.channel.journal.v1',chainId:this.info.chainId,channelId:opening.channelId,sequence,previousHash:journal.previousHash,messageHash,authorization:message,signature:journal.signature,inputHash:message.inputHash,output:message.inputHash,outputHash:nativeHash(message.inputHash),amountAtoms:'100',recordedAt:journal.recordedAt};
    sdkEqual(journal,expectedJournal,'Invalid channel computation journal metadata');
    const journalHash=nativeHash(nativeCanonical(expectedJournal)),spentAtoms=(BigInt(sequence)*100n).toString(),remainingAtoms=(BigInt(opening.depositAtoms)-BigInt(spentAtoms)).toString();
    sdkEqual(response.result,{kind:'native-channel-call',channelId:opening.channelId,sequence,messageHash,output:message.inputHash,outputHash:expectedJournal.outputHash,authorizedAtoms:'100',settledAtoms:'0',feeAtoms:'0',spentAtoms,remainingAtoms,journalHash,evidence:'operator provisional acknowledgment of collateral-backed authorization; final accounting at channel close'},'Channel call result mismatch');
    sdkEqual(response.channel,{...opening,sequence,spentAtoms,remainingAtoms,journalHead:journalHash},'Channel call state mismatch');
    const seen=terms.journals.get(sequence);if(seen!==undefined&&seen!==journalHash)throw new Error('Channel replay changed an accepted journal');
    terms.journals.set(sequence,journalHash);return response;
  }
  async openChannel(key:NativeKey,capacity:number,lifetimeMs=3600000){
    const flight=this.channelOpenFlights.get(key.address);
    if(flight){if(flight.capacity!==capacity||flight.lifetimeMs!==lifetimeMs)throw new Error('Another channel opening is in progress for this owner');return flight.promise;}
    const promise=this.performChannelOpen(key,capacity,lifetimeMs);this.channelOpenFlights.set(key.address,{capacity,lifetimeMs,promise});
    try{return await promise;}finally{this.channelOpenFlights.delete(key.address);}
  }
  private async performChannelOpen(key:NativeKey,capacity:number,lifetimeMs:number){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>10000||!Number.isSafeInteger(lifetimeMs)||lifetimeMs<1||lifetimeMs>86400000)throw new Error('Use a bounded channel capacity and lifetime');
    if(nativeAddress(key.publicKey)!==key.address)throw new Error('Invalid channel owner key');
    let pending=this.pendingChannelOpens.get(key.address);
    if(pending&&(pending.capacity!==capacity||pending.lifetimeMs!==lifetimeMs))throw Object.assign(new Error('An earlier channel opening must be reconciled first'),{pendingTransactionHash:nativeHash(nativeCanonical(pending.envelope.transaction))});
    if(!pending){const sessionKey=nativeGenerateKey(),expiresAt=new Date(Date.now()+lifetimeMs).toISOString();const envelope=await this.authorize(key,[{type:'channel.open',sessionPublicKey:sessionKey.publicKey,capacity,expiresAt,service:'hash'}],(BigInt(capacity)*100n+12n).toString());pending={envelope,sessionKey,capacity,lifetimeMs};this.pendingChannelOpens.set(key.address,pending);}
    const hash=nativeHash(nativeCanonical(pending.envelope.transaction));
    try{const result=await this.submit(pending.envelope);const terms=await this.trustedChannel(hash,result.receipt);this.pendingChannelOpens.delete(key.address);return {...result,sessionKey:pending.sessionKey,channel:structuredClone(terms.opening)};}
    catch(error:any){
      // These server codes are raised before append. Transport and receipt failures remain uncertain.
      if(['expired','insufficient_balance','spending_cap','wrong_nonce','invalid_channel','invalid_channel_expiry','separate_session_key','channel_capacity','channel_lifetime_limit','devnet_capacity'].includes(error?.code))this.pendingChannelOpens.delete(key.address);
      throw Object.assign(error instanceof Error?error:new Error('Channel opening failed'),{pendingTransactionHash:hash});
    }
  }
  /** Public state is checked against signed terms; this does not prove the server's latest head. */
  async channel(id:string){const terms=await this.trustedChannel(id);return this.checkedChannel(await this.request('/channels/'+id),terms.opening);}
  async channelJournal(id:string,after=0){
    if(!Number.isSafeInteger(after)||after<0||after>10000)throw new Error('Invalid channel journal cursor');
    const terms=await this.trustedChannel(id),page=await this.request('/channels/'+id+'/journal?after='+after);
    if(!Array.isArray(page.journal)||page.journal.length>20||!Number.isSafeInteger(page.next)||page.next!==after+page.journal.length)throw new Error('Invalid channel journal page');sdkDigest(page.head);
    for(let i=0;i<page.journal.length;i++){if(page.journal[i]?.journal?.sequence!==after+i+1)throw new Error('Noncontiguous channel journal page');this.checkedChannelCall(page.journal[i],terms);}
    return page;
  }
  authorizeChannelCall(sessionKey:NativeKey,channelId:string,sequence:number,input:string){
    sdkDigest(channelId);if(typeof input!=='string'||input.length<1||input.length>4000)throw new Error('Use 1–4000 input characters');
    const message={domain:'cinder.channel-call.v1',chainId:'cinder-devnet-1',channelId,sequence,inputHash:nativeHash(input)};channelMessageHash(message);
    const opening=this.channelTerms.get(channelId)?.opening;if(opening&&(opening.sessionPublicKey!==sessionKey.publicKey||sequence>opening.capacity))throw new Error('Session key or sequence differs from channel terms');
    if(nativeAddress(sessionKey.publicKey)!==sessionKey.address)throw new Error('Invalid channel session key');
    return {message,signature:nativeSign(message,sessionKey.secretKey),input};
  }
  async submitChannelCall(envelope:any,sessionPublicKey:string,previousHash?:string){
    exact(envelope,['message','signature','input']);channelMessageHash(envelope.message);const terms=await this.trustedChannel(envelope.message.channelId);
    if(sessionPublicKey!==terms.opening.sessionPublicKey||!nativeVerify(envelope.message,envelope.signature,sessionPublicKey)||typeof envelope.input!=='string'||envelope.input.length<1||envelope.input.length>4000||nativeHash(envelope.input)!==envelope.message.inputHash||envelope.message.sequence>terms.opening.capacity)throw new Error('Invalid channel request authorization or input');
    return this.checkedChannelCall(await this.request('/channels/call',envelope),terms,envelope.message,previousHash);
  }
  async closeChannel(key:NativeKey,channelId:string){
    const terms=await this.trustedChannel(channelId);if(key.address!==terms.opening.owner)throw new Error('Only the channel owner may close it');
    const response=await this.transact(key,{type:'channel.close',channelId},'12'),result=response.receipt.result,opening=terms.opening;
    if(!Number.isSafeInteger(result?.callCount)||result.callCount<0||result.callCount>opening.capacity)throw new Error('Invalid channel closing count');
    const head=sdkDigest(result.journalHead),spent=BigInt(result.callCount)*100n,remaining=BigInt(opening.depositAtoms)-spent;
    if((result.callCount===0&&head!==opening.journalHead)||(terms.journals.has(result.callCount)&&terms.journals.get(result.callCount)!==head))throw new Error('Channel closing journal mismatch');
    sdkEqual(result,{kind:'native-channel-close',channelId,feeAtoms:'12',reason:'owner',settledAtoms:spent.toString(),refundedAtoms:remaining.toString(),callCount:result.callCount,journalHead:head,depositAtoms:opening.depositAtoms,evidence:'operator checkpoint settlement of the committed authorization journal'},'Channel close result mismatch');
    const postings:any[]=[{account:key.address,deltaAtoms:'-12'},{account:'system:fees',deltaAtoms:'12'}];
    if(spent>0n)postings.push({account:opening.escrow,deltaAtoms:(-spent).toString()},{account:'system:provider',deltaAtoms:spent.toString()});
    if(remaining>0n)postings.push({account:opening.escrow,deltaAtoms:(-remaining).toString()},{account:opening.owner,deltaAtoms:remaining.toString()});
    sdkEqual(response.receipt.postings,postings,'Channel close postings mismatch');return response;
  }

}
