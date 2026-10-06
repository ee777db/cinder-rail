import assert from 'node:assert/strict';
import {nativeAddress,nativeVerify,nativeCanonical,nativeHash} from '../../src/native-crypto.ts';
import {NATIVE_CHAIN,NATIVE_SUPPLY,NATIVE_ADDRESS,applyNativeTransaction} from '../../src/native-core.ts';
import {applyMusic} from '../../src/native-music.ts';
import {applyEconomy,initialEconomyState} from '../../src/native-economy.ts';
import {openChannel,closeChannel,expireChannel} from '../../src/native-channel.ts';
const equal=(a,b,message)=>assert.equal(nativeCanonical(a),nativeCanonical(b),message);
const account=(address,balanceAtoms='0',createdAt=new Date(0).toISOString())=>({address,balanceAtoms,nonce:0,claimedFaucet:false,createdAt});
export function createReplay(genesis,signature,hash,pinnedKey){
 assert.equal(genesis.domain,'cinder.genesis.v1');assert.equal(genesis.chainId,NATIVE_CHAIN);assert.equal(genesis.supplyAtoms,NATIVE_SUPPLY);assert.equal(genesis.decimals,6);assert.equal(genesis.allocation,'system:reserve');
 if(pinnedKey)assert.equal(genesis.operatorPublicKey,pinnedKey);assert.ok(nativeVerify(genesis,signature,genesis.operatorPublicKey),'Genesis signature');assert.equal(nativeHash(nativeCanonical(genesis)),hash);
 return {genesis,hash,height:0,timestamp:Date.parse(genesis.createdAt),signatures:1,accounts:{'system:reserve':account('system:reserve',NATIVE_SUPPLY,genesis.createdAt),'system:fees':account('system:fees'),'system:provider':account('system:provider')},music:undefined,economy:initialEconomyState(),channels:{},jobs:{}};
}
export async function replayReceipt(state,receipt,publicKeys,readChannelJournal){
 const {checkpoint:cp,transaction:tx,postings,result}=receipt;
 assert.equal(cp.domain,'cinder.checkpoint.v1');assert.equal(cp.chainId,NATIVE_CHAIN);assert.equal(cp.height,state.height+1);assert.equal(cp.previousHash,state.hash);assert.equal(cp.mode,'single-operator-devnet');
 const now=Date.parse(cp.timestamp);assert.equal(new Date(now).toISOString(),cp.timestamp);assert.ok(now>=state.timestamp,'Monotonic checkpoint clock');assert.ok(nativeVerify(cp,receipt.checkpointSignature,state.genesis.operatorPublicKey),'Checkpoint signature');
 assert.equal(cp.transactionHash,nativeHash(nativeCanonical(tx)));assert.equal(cp.postingsHash,nativeHash(nativeCanonical(postings)));assert.equal(cp.resultHash,nativeHash(nativeCanonical(result)));assert.equal(tx.chainId,NATIVE_CHAIN);
 for(const [address,key]of Object.entries(publicKeys)){assert.equal(nativeAddress(key),address,'Public key must derive the claimed account');state.accounts[address]??=account(address);if(state.accounts[address].publicKey)assert.equal(state.accounts[address].publicKey,key);state.accounts[address].publicKey=key;}
 let transition;
 if(tx.domain==='cinder.transaction.v1'){
  assert.ok(NATIVE_ADDRESS.test(tx.sender));assert.ok(nativeVerify(tx,receipt.signature,state.accounts[tx.sender]?.publicKey),'Payer authorization');state.signatures++;
  const action=tx.actions[0],type=action.type;
  if(type.startsWith('music.')){
   const recorded=type==='music.publish'?result.track?.publishedAt:type==='music.unpublish'?result.track?.unpublishedAt:result.access?.createdAt;const operationTime=Date.parse(recorded);assert.ok(operationTime>=state.timestamp&&operationTime<=now,'Music annotation must fall within its checkpoint interval');
   transition=applyMusic(state.accounts,state.music,tx,operationTime);equal(transition.result,result,'Music evidence and declared split must follow authorization');state.music=transition.state;
  }else if(type.startsWith('economy.')){
   for(const address of ['system:economy-pool','system:economy-provider'])state.accounts[address]??=account(address);
   // The historical operator uses only touched wallet shards. Audit.loadedWallets is a transport diagnostic, not an economic field.
   transition=applyEconomy(state.accounts,state.economy,tx,now);const {audit:actualAudit,...actual}=result,{audit:expectedAudit,...expected}=transition.result;
   if(type==='economy.redeem'){assert.equal(actual.output,action.inputHash);assert.equal(actual.outputHash,nativeHash(actual.output));assert.equal(actual.model,'sha384-v1');delete actual.output;delete actual.outputHash;delete actual.model;delete actual.evidence;}
   equal(actual,expected,'Resource movements and pool math must follow authorization');for(const key of ['inventoryWork','burnedWork','walletWorkTotal','poolWork','lpSupply','walletLpTotal'])assert.equal(actualAudit[key],expectedAudit[key]);state.economy=transition.state;
  }else if(type==='channel.open'){
   const operationTime=Date.parse(result.channel?.openedAt);assert.ok(operationTime>=state.timestamp&&operationTime<=now);transition=openChannel(state.accounts,tx,operationTime);equal(transition.result,result,'Channel collateral authorization');state.channels[transition.channel.channelId]=transition.channel;
  }else if(type==='channel.close'){
   const channel=await replayChannel(state,action.channelId,result,readChannelJournal);transition=closeChannel(state.accounts,channel,tx,now);equal(transition.result,result,'Channel settlement');state.channels[channel.channelId]=transition.channel;
  }else{transition=applyNativeTransaction(state.accounts,tx,now);equal(transition.result,result,'Native movements must match signed actions and spending cap');if(transition.compute)state.jobs[cp.transactionHash]={...transition.compute,sender:tx.sender,settled:false};}
 }else if(tx.domain==='cinder.channel-expiry.v1'){
  assert.equal(receipt.signature,null);const channel=await replayChannel(state,tx.channelId,result,readChannelJournal);transition=expireChannel(state.accounts,channel,now);equal(transition.transaction,tx);equal(transition.result,result);state.channels[channel.channelId]=transition.channel;
 }else if(tx.domain==='cinder.compute-settlement.v1'){
  assert.equal(receipt.signature,null);const job=state.jobs[tx.requestTxHash];assert.ok(job&&!job.settled,'Settlement must consume an existing unique reservation');assert.ok(['complete','failed'].includes(tx.status));assert.equal(tx.amountAtoms,job.amountAtoms);assert.equal(result.requestTxHash,tx.requestTxHash);assert.equal(result.service,job.service);assert.equal(result.status,tx.status);
  const target=tx.status==='complete'?'system:provider':job.sender;assert.equal(result.refundAtoms,tx.status==='complete'?'0':job.amountAtoms);
  if(tx.status==='complete'){assert.equal(tx.outputHash,nativeHash(result.output));if(job.service==='hash')assert.equal(result.output,job.inputHash);}else assert.equal(tx.outputHash,null);
  assert.equal(state.accounts[job.escrow].balanceAtoms,job.amountAtoms);const accounts=structuredClone(state.accounts);accounts[job.escrow].balanceAtoms='0';accounts[target].balanceAtoms=(BigInt(accounts[target].balanceAtoms)+BigInt(job.amountAtoms)).toString();transition={accounts,postings:[{account:job.escrow,deltaAtoms:'-'+job.amountAtoms},{account:target,deltaAtoms:job.amountAtoms}]};job.settled=true;
 }else throw new Error('Unsupported system transaction domain');
 equal(transition.postings,postings,'Posted debits must exactly implement the authorized state transition');state.accounts=transition.accounts;
 assert.equal(Object.values(state.accounts).reduce((s,a)=>s+BigInt(a.balanceAtoms),0n),BigInt(NATIVE_SUPPLY));for(const a of Object.values(state.accounts))assert.ok(BigInt(a.balanceAtoms)>=0n);
 state.hash=nativeHash(nativeCanonical(cp));state.height=cp.height;state.timestamp=now;state.signatures++;return state;
}
async function replayChannel(state,id,result,readJournal){
 const channel=structuredClone(state.channels[id]);assert.ok(channel&&channel.status==='open','Channel must have a verified opening');assert.ok(Number.isSafeInteger(result.callCount)&&result.callCount>=0&&result.callCount<=channel.capacity);assert.ok(readJournal,'Channel close requires authorization journal replay');
 const records=await readJournal(id);assert.equal(records.length,result.callCount,'All accepted calls must be available');let previous=channel.journalHead;
 for(let i=0;i<records.length;i++){
  const journal=records[i].journal??records[i],m=journal.authorization;assert.equal(journal.domain,'cinder.channel.journal.v1');assert.equal(journal.chainId,NATIVE_CHAIN);assert.equal(journal.channelId,id);assert.equal(journal.sequence,i+1);assert.equal(journal.previousHash,previous);assert.equal(m.domain,'cinder.channel-call.v1');assert.equal(m.chainId,NATIVE_CHAIN);assert.equal(m.channelId,id);assert.equal(m.sequence,i+1);assert.ok(nativeVerify(m,journal.signature,channel.sessionPublicKey),'Channel session authorization');
  assert.equal(journal.messageHash,nativeHash(nativeCanonical(m)));assert.equal(journal.inputHash,m.inputHash);assert.equal(journal.output,m.inputHash);assert.equal(journal.outputHash,nativeHash(journal.output));assert.equal(journal.amountAtoms,channel.priceAtoms);assert.ok(Date.parse(journal.recordedAt)<Date.parse(channel.expiresAt));previous=nativeHash(nativeCanonical(journal));state.signatures++;
 }
 assert.equal(previous,result.journalHead);channel.sequence=records.length;channel.spentAtoms=(BigInt(records.length)*BigInt(channel.priceAtoms)).toString();channel.remainingAtoms=(BigInt(channel.depositAtoms)-BigInt(channel.spentAtoms)).toString();channel.journalHead=previous;return channel;
}
