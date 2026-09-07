import {nativeGenerateKey,nativeSign,nativeVerify,nativeHash,nativeCanonical,type NativeKey} from '../src/native-crypto.ts';
export {nativeGenerateKey,nativeHash,nativeCanonical};
export class CinderNativeClient {
  private info:any;
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
    if(expectedTransaction&&nativeCanonical(transaction)!==nativeCanonical(expectedTransaction))throw new Error('Receipt has another transaction');
    if(postings.reduce((sum:bigint,p:any)=>sum+BigInt(p.deltaAtoms),0n)!==0n)throw new Error('Receipt violates posting conservation');
    return true;
  }
  async authorize(key:NativeKey,actions:any[],maxDebitAtoms:string){
    if(!this.info)await this.connect();const current=await this.account(key.address);
    let debit=actions.length===1&&actions[0].type==='faucet'?0n:10n+2n*BigInt(actions.length);
    for(const a of actions){if(a.type==='transfer'||a.type==='split')debit+=BigInt(a.amountAtoms);else if(a.type==='compute'){const service=this.info.services.find((s:any)=>s.id===a.service);if(!service)throw new Error('Unknown compute service');debit+=BigInt(service.amountAtoms);}else if(a.type!=='faucet')throw new Error('Unknown action');}
    if(debit>BigInt(maxDebitAtoms))throw new Error('Native debit exceeds the local spending cap');
    const transaction={domain:'cinder.transaction.v1',chainId:this.info.chainId,sender:key.address,nonce:current.nonce+1,validUntil:new Date(Date.now()+120000).toISOString(),maxDebitAtoms,actions};
    return {transaction,signature:nativeSign(transaction,key.secretKey)};
  }
  /** Save this signed envelope while a network result is uncertain; retry it, never a new nonce. */
  async submit(envelope:any,computeInput?:string){const result=await this.request('/submit',{...envelope,...(computeInput!==undefined?{computeInput}:{})});if(result.txHash!==nativeHash(nativeCanonical(envelope.transaction)))throw new Error('Transaction identifier mismatch');this.verifyReceipt(result.receipt,envelope.transaction);return result;}
  async claimFaucet(key:NativeKey){return this.submit(await this.authorize(key,[{type:'faucet'}],'0'));}
  async transfer(key:NativeKey,to:string,amountAtoms:string,maxDebitAtoms:string){return this.submit(await this.authorize(key,[{type:'transfer',to,amountAtoms}],maxDebitAtoms));}
  async splitUsage(key:NativeKey,app:'music'|'agent'|'trade',recipients:Array<{address:string,bps:number}>,amountAtoms:string,reference:string,units:number,maxDebitAtoms:string){return this.submit(await this.authorize(key,[{type:'split',app,recipients,amountAtoms,referenceHash:nativeHash(reference),units}],maxDebitAtoms));}
  async compute(key:NativeKey,service:'hash'|'inference',input:string,maxDebitAtoms:string){const envelope=await this.authorize(key,[{type:'compute',service,inputHash:nativeHash(input)}],maxDebitAtoms);return this.submit(envelope,input);}
  async job(hash:string){const job=await this.request('/jobs/'+encodeURIComponent(hash));if(job.receipt){this.verifyReceipt(job.receipt);if(job.receipt.transaction.requestTxHash!==hash||job.receipt.result.requestTxHash!==hash||job.receipt.result.status!==job.status)throw new Error('Compute job receipt mismatch');if(job.status==='complete'&&(job.receipt.result.output!==job.output||nativeHash(job.output)!==job.receipt.transaction.outputHash))throw new Error('Compute output hash mismatch');}return job;}
}
