import assert from 'node:assert/strict';
const base=(process.env.CINDER_URL||'http://127.0.0.1:8787').replace(/\/$/,'');
const pages=['/','/protocol','/developers','/launch','/security','/privacy'];
for(const path of pages){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.equal(r.redirected,false,path+' redirected');assert.match(r.headers.get('content-type'),/text\/html/);const text=await r.text();assert.match(text,/Cinder Rail|Cinder<span/);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);console.log('PASS page '+path);}
for(const path of ['/app.js','/style.css','/icon.svg','/robots.txt','/sitemap.xml']){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.doesNotMatch(r.headers.get('content-type'),/text\/html/);console.log('PASS asset '+path);}
for(const path of ['/api/health','/api/catalog','/api/key','/openapi.json','/.well-known/cinder.json']){const r=await fetch(base+path);assert.equal(r.status,200,path);assert.equal(typeof await r.json(),'object');console.log('PASS JSON '+path);}
const missing=await fetch(base+'/this-page-does-not-exist');assert.equal(missing.status,404);console.log('PASS real 404');
console.log('All 17 deployed page, asset, discovery and error checks passed.');
