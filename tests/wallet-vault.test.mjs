import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeGenerateKey} from '../src/native-crypto.ts';
import {encryptWallet,decryptWallet} from '../browser/wallet-vault.ts';
const key=nativeGenerateKey(),password='Cinder test vault phrase 2026!',chain='cinder-devnet-1';
test('encrypted wallet backup restores the exact key without plaintext key disclosure',async()=>{const vault=await encryptWallet(key,password,chain),text=JSON.stringify(vault);assert.ok(!text.includes(key.secretKey));assert.deepEqual(await decryptWallet(text,password,chain),key);});
test('incorrect password, changed ciphertext and changed authenticated header fail closed',async()=>{const vault=await encryptWallet(key,password,chain);await assert.rejects(decryptWallet(JSON.stringify(vault),password+'wrong',chain));for(const edit of [v=>v.ciphertext=(v.ciphertext[0]==='A'?'B':'A')+v.ciphertext.slice(1),v=>v.kdf.iterations++]){const damaged=structuredClone(vault);edit(damaged);await assert.rejects(decryptWallet(JSON.stringify(damaged),password,chain));}});
test('wallet backups bind network, reject weak passwords and randomize every encryption',async()=>{await assert.rejects(encryptWallet(key,'short',chain));const a=await encryptWallet(key,password,chain),b=await encryptWallet(key,password,chain);assert.notEqual(a.kdf.salt,b.kdf.salt);assert.notEqual(a.cipher.iv,b.cipher.iv);assert.notEqual(a.ciphertext,b.ciphertext);await assert.rejects(decryptWallet(JSON.stringify(a),password,'cinder-other'));});
