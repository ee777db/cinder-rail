import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReplay,replayReceipt} from './lib/ledger-replay.mjs';
const base=(process.env.CINDER_URL||'http://127.0.0.1:8899').replace(/\/$/,'');
const get=async path=>{const response=await fetch(base+'/api/native'+path);assert.equal(response.status,200,'Read '+path);return response.json();};
const info=await get('/info'),record=await get('/genesis'),state=createReplay(record.genesis,record.signature,record.hash,process.env.CINDER_OPERATOR_KEY||info.signer.publicKey),target=info.head.height;
async function journal(id){let after=0,rows=[];while(true){const page=await get('/channels/'+id+'/journal?after='+after);rows.push(...page.journal);if(!page.journal.length||page.journal.length<20)break;assert.ok(page.next>after);after=page.next;}return rows;}
while(state.height<target){const page=await get('/export?after='+state.height);assert.ok(page.receipts.length);for(const receipt of page.receipts){if(receipt.checkpoint.height>target)break;await replayReceipt(state,receipt,page.publicKeys,journal);}}
assert.equal(state.hash,info.head.hash);const report={network:base,checkedAt:new Date().toISOString(),chainId:info.chainId,checkpoints:state.height,signaturesVerified:state.signatures,headHash:state.hash,genesisHash:record.hash,nativeSupplyAtoms:record.genesis.supplyAtoms,workSupplyIncludingConsumed:'1000000',operatorPublicKey:record.genesis.operatorPublicKey,authorizedStateTransitions:true,channelJournalsVerified:true,scope:'Independent replay of native accounting, resource market, music splits and channel authorization journals. This is verification of a single operator journal, not independent network consensus, service availability or correct LLM inference.'};
if(process.env.CINDER_REPORT)await fs.writeFile(process.env.CINDER_REPORT,JSON.stringify(report,null,2)+'\n');const {operatorPublicKey,...summary}=report;console.log(JSON.stringify(summary));
