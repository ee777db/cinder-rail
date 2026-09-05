#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const file=process.argv[2];if(!file)throw new Error('Usage: node scripts/verify-receipt.mjs receipt.json [pinned-key.json]');
const data=JSON.parse(await readFile(file,'utf8'));
const issuer=process.argv[3]?JSON.parse(await readFile(process.argv[3],'utf8')):data.issuer;
if(!issuer?.publicKey)throw new Error('Provide an issuer public key or export containing issuer.');
const key=await webcrypto.subtle.importKey('jwk',issuer.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
const payload=canonical(data.receipt);const valid=payload===data.signingPayload&&data.receipt.keyId===issuer.keyId&&await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(data.signature,'base64url'),new TextEncoder().encode(payload));
const outputValid=data.receipt.outputHash===createHash('sha256').update(data.output).digest('hex');
if(!valid||!outputValid)throw new Error('INVALID receipt: signature, key identifier, serialization or output hash failed.');
console.log('Valid issuer signature and output hash. '+(process.argv[3]?'Verified against supplied pinned issuer key.':'Issuer key came from this export; independently pin it to establish trust.')+' This does not prove inference correctness.');
