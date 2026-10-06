import fs from 'node:fs/promises';
import path from 'node:path';
import {marked} from 'marked';
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const template=(title,content)=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — Cinder Rail</title><meta name="description" content="Cinder Rail: Native testnet for machine budgets, creator payments and resource exchange."><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/docs.css"></head><body><header><a href="/">◈ CINDER RAIL</a><nav><a href="/">Console</a><a href="/protocol">Protocol</a><a href="/developers">Developers</a><a href="/explorer">Explorer</a><a href="/research">Research</a></nav></header><main>${content}</main><footer>CINDER native testnet · 单运营方开发网络 · 测试资产无现金价值 · <a href="/privacy">Privacy</a></footer></body></html>`;
await fs.mkdir('public/docs',{recursive:true});
const files=(await fs.readdir('docs')).filter(f=>f.endsWith('.md'));
const historical=new Set(['README.md','architecture.md','economics.md','founder-memo-zh.md','launch.md','native-design.md','release-v0.1.0.md','roadmap.md','verification.md']);
function render(source){return marked.parse(source,{walkTokens(token){if(token.type!=='link')return;const href=token.href;if(href.startsWith('../public/'))token.href=href.replace('../public/','/');else if(href.startsWith('../'))token.href='https://github.com/ee777db/cinder-rail/blob/main/'+href.slice(3);else if(/^[^/:#]+\.md(?:#.*)?$/.test(href))token.href='/docs/'+href.replace(/\.md(?=#|$)/,'.html');}});}
for(const f of files){
  const source=await fs.readFile(path.join('docs',f),'utf8'),title=source.match(/^# (.+)/m)?.[1]||f;
  const notice=historical.has(f)?'<aside class="history">历史文档 / design record. Current implementation: <a href="/protocol">v0.2 whitepaper</a> · <a href="/docs/completion-gate.html">verified capabilities</a>.</aside>':'';
  await fs.writeFile(path.join('public/docs',f.replace('.md','.html')),template(title,notice+render(source)));
  await fs.copyFile(path.join('docs',f),path.join('public/docs',f));
}
for (const name of ['security','privacy']) {
  const source=await fs.readFile(`docs/${name}.md`,'utf8');
  await fs.writeFile(`public/${name}.html`,template(name,render(source)));
}
await fs.writeFile('public/docs.css',`*{box-sizing:border-box}body{margin:0;background:#f5f3ec;color:#252820;font:16px/1.8 system-ui,sans-serif}aside.history{padding:16px;background:#ffe8d7;border-left:3px solid #c54c24;margin-bottom:28px}header,footer{max-width:1100px;margin:auto;padding:28px;display:flex;justify-content:space-between;gap:20px}header>a{font-weight:800;letter-spacing:.12em}nav{display:flex;gap:20px}a{color:#a83a18;text-underline-offset:4px}header a{text-decoration:none}main{max-width:860px;margin:36px auto 100px;padding:0 24px}h1{font-size:clamp(32px,6vw,54px);line-height:1.12;letter-spacing:-.045em}h2{margin-top:2em;line-height:1.2}h3{line-height:1.3}pre{background:#20271f;color:#f5f3ec;padding:24px;overflow:auto;border-radius:12px}code{font-size:.88em}table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{border-bottom:1px solid #ccc8bc;text-align:left;padding:12px;min-width:120px}blockquote{border-left:3px solid #dc592e;margin-left:0;padding-left:20px}footer{border-top:1px solid #ccc8bc;font-size:12px;display:block}@media(max-width:600px){header{flex-direction:column}nav{flex-wrap:wrap}main{margin-top:12px}}`);
await fs.writeFile('public/llms.txt',`# Cinder Rail 0.2

Native testnet cinder-devnet-1. CINDER is self-issued with 6 decimals; it is not a dollar stablecoin or an external-chain token. WORK is a finite entitlement to a bounded SHA-384 computation, not LLM inference. Test assets have no cash value.

- [Application](/)
- [Public ledger explorer](/explorer)
- [Whitepaper](/protocol)
- [Developer guide](/developers)
- [Coin research in Chinese](/research)
- [Native network parameters and operator public key](/api/native/info)
- [Genesis](/api/native/genesis)
- [API catalog](/openapi.json)
- [SDK](/native-sdk.js)
- [Security](/security)
- [Privacy](/privacy)

ML-DSA-65 authorization, SHA-384 commitments, integer double-entry accounting, bounded compute channels, signed music uploads and paid access, CINDER/WORK spot AMM. Single operator checkpoints are not independent-validator finality. Signatures prove authorization/provenance, not correctness of LLM inference. No claim of end-to-end post-quantum hosting or cryptographic audit. Legacy P-256 HTTP402 sandbox remains under /compute and /api/sessions; it is separate and not x402 wire compatible.
`);
await fs.mkdir('public/.well-known',{recursive:true});
await fs.writeFile('public/.well-known/cinder.json',JSON.stringify({name:'Cinder Rail',version:'0.2.0',protocol:'cinder-native-v1',chainId:'cinder-devnet-1',assetId:'cinder-devnet-1/native',mode:'single-operator-devnet',info:'/api/native/info',genesis:'/api/native/genesis',export:'/api/native/export',sdk:'/native-sdk.js',openapi:'/openapi.json',documentation:'/developers',whitepaper:'/protocol',signatures:'ML-DSA-65',hash:'SHA-384',cashValue:false,mainnet:false,x402Compatible:false},null,2));
await fs.writeFile('public/robots.txt','User-agent: *\nAllow: /\nDisallow: /api/sessions/\nDisallow: /api/native/media/\nSitemap: https://cinder-rail.ee777db.workers.dev/sitemap.xml\n');
const site='https://cinder-rail.ee777db.workers.dev';
await fs.writeFile('public/sitemap.xml','<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/','/protocol','/developers','/explorer','/research','/launch','/security','/privacy'].map(route=>'<url><loc>'+site+route+'</loc></url>').join('')+'</urlset>');
console.log(`Built ${files.length} protocol documents, privacy, security and native agent discovery files.`);
