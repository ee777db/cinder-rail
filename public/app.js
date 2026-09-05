'use strict';

const icons = {
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>',
  agent: '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="5" y="8" width="22" height="18" rx="3"/><path d="M16 3v5M11 16h1m8 0h1M11 21h10M2 15v6m28-6v6"/><circle cx="16" cy="3" r="1" fill="currentColor"/></svg>',
  compute: '<svg width="31" height="31" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><rect x="7" y="7" width="18" height="18" rx="2"/><rect x="12" y="12" width="8" height="8" rx="1"/><path d="M11 3v4m5-4v4m5-4v4M11 25v4m5-4v4m5-4v4M3 11h4m-4 5h4m-4 5h4m18-10h4m-4 5h4m-4 5h4"/></svg>',
  check: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  shield: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m12 3 8 3v6c0 4-5 8-8 10-3-2-8-6-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg>',
  receipt: '<svg width="31" height="31" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M8 3h16v26l-4-2-4 2-4-2-4 2V3Z"/><path d="M12 10h8m-8 5h8m-8 5h5"/></svg>',
  hash: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m9 3-3 18M18 3l-3 18M3 8h19M2 16h19"/></svg>',
  spark: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg>',
  reset: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 9a8 8 0 1 1 0 7M4 3v6h6"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>',
  info: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v2"/></svg>',
  meter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 18a10 10 0 1 1 16 0H4Z"/><path d="m12 13 5-5M4 13h2m6-10v3m6 7h2"/><circle cx="12" cy="13" r="1.5"/></svg>',
  key: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="9" r="5"/><path d="m12 13 9 9m-5-5 3-3m-6 0 3-3"/></svg>'
};

const main = document.getElementById('main');
const path = location.pathname.replace(/\/$/, '') || '/';
const esc = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const amount = micros => Number.isSafeInteger(micros) ? '$' + (micros / 1000000).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00') : '—';
const short = value => value ? String(value).slice(0, 8) + '…' + String(value).slice(-4) : '—';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const bytes = value => new TextEncoder().encode(value);
const toBase64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)))].map(x => x.toString(16).padStart(2, '0')).join(''); }

for (const link of document.querySelectorAll('[data-route]')) if (link.dataset.route === path) link.setAttribute('aria-current', 'page');

function consoleMarkup() {
  return `<section class="hero" aria-labelledby="hero-title"><div><p class="eyebrow">An open rail for machine commerce</p><h1 id="hero-title">Small payments.<br><em>Visible proof.</em></h1><p class="hero-description">Give an agent a budget. Let it buy a little compute.<br>Get a receipt you can actually verify.</p></div><div class="hero-aside"><div class="rail-diagram" aria-label="Agent signs, compute executes, receipt verifies"><div class="rail-node"><div class="node-icon">${icons.agent}</div><span class="node-label">01 / AGENT</span></div><span class="rail-arrow" aria-hidden="true">╌→</span><div class="rail-node"><div class="node-icon">${icons.compute}</div><span class="node-label">02 / COMPUTE</span></div><span class="rail-arrow" aria-hidden="true">╌→</span><div class="rail-node"><div class="node-icon">${icons.receipt}</div><span class="node-label">03 / RECEIPT</span></div></div><div class="hero-aside-bottom"><p class="small-copy">Real cryptography. Test credits.<br>No token required.</p><a class="quiet-link" href="/protocol">How the rail works ${icons.arrow}</a></div></div></section>
  <section aria-labelledby="console-heading"><div class="section-bar"><div class="section-heading"><span class="section-number">01</span><h2 id="console-heading">Compute console</h2><span class="badge">LIVE SANDBOX</span></div><span class="connection loading" id="connection" role="status"><span class="status-dot"></span><span>Connecting</span></span></div><div class="console"><div class="console-toolbar"><div class="session-label">${icons.key}<span id="session-label">Ephemeral agent / not started</span></div><button class="text-button" id="reset" disabled>${icons.reset}New session</button></div><div class="console-body"><form class="request-panel" id="request-form"><div class="field-label"><span>Choose a service</span><span class="field-note">FIXED TEST PRICING</span></div><div class="service-options" id="service-options" role="group" aria-label="Compute service"><button type="button" class="service-option skeleton" disabled aria-label="Loading services">Loading services</button><button type="button" class="service-option skeleton" disabled aria-label="Loading services">Loading services</button></div><label class="field-label" for="request-input"><span>Request input</span><span class="field-note" id="input-type">PLAIN TEXT</span></label><div class="input-wrap"><textarea id="request-input" rows="3" required maxlength="4000" spellcheck="false" aria-describedby="input-hint input-count">The future of commerce is a conversation between machines.</textarea><span class="input-count" id="input-count">0 / 4,000</span></div><p class="input-hint" id="input-hint">Create a verifiable SHA-256 fingerprint of your text.</p><div class="budget-row"><label class="budget-copy" for="budget">${icons.shield}<span>Per-request spending cap<small>Test USD equivalent · no real money</small></span></label><div class="budget-input"><span aria-hidden="true">$</span><input id="budget" type="text" inputmode="decimal" value="0.001" required pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?" aria-label="Per-request cap in test USD equivalent" /></div></div><div id="error" class="error-box" role="alert" hidden></div><button class="primary-button" id="run" type="submit" disabled><span>Run paid request</span>${icons.arrow}</button><p class="run-note" id="run-note">A browser agent signs. No wallet or account needed.</p></form><section class="result-panel" aria-labelledby="result-heading"><div class="result-topline"><h3 id="result-heading">Execution receipt</h3><span class="result-state" id="result-state" role="status">AWAITING REQUEST</span></div><div id="result" class="empty-result"><div class="empty-glyph" aria-hidden="true"><svg viewBox="0 0 60 75" fill="none"><path d="M6 2h47v66l-6-3-6 3-6-3-6 3-6-3-6 3-6-3-5 3V2Z" fill="#fcfcf6" stroke="#c8ceba"/><path d="M17 17h25M17 24h25M17 31h16" stroke="#b9c1aa"/><circle cx="30" cy="48" r="8" fill="#edf0e3" stroke="#c7cfb7"/><path d="m26 48 3 3 5-6" stroke="#9eab8d"/></svg></div><h4>Your first receipt starts here.</h4><p>Run a request to see the quote, signature, output, and proof come together.</p></div><ol class="trace" aria-label="Request progress" id="trace"><li data-state="idle"><span><i class="trace-dot"></i>01 / QUOTE</span><span class="trace-label">HTTP 402</span></li><li data-state="idle"><span><i class="trace-dot"></i>02 / SIGN</span><span class="trace-label">Agent approval</span></li><li data-state="idle"><span><i class="trace-dot"></i>03 / RUN</span><span class="trace-label">Compute</span></li><li data-state="idle"><span><i class="trace-dot"></i>04 / VERIFY</span><span class="trace-label">Receipt check</span></li></ol></section></div><div class="console-stats"><div class="stat"><span class="stat-label">Available test balance</span><span class="stat-value" id="balance">—<small>test USD</small></span></div><div class="stat"><span class="stat-label">Session spend</span><span class="stat-value" id="spend">—<small>test USD</small></span></div><div class="stat"><span class="stat-label">Verified receipts</span><span class="stat-value" id="verified-count">0<small>this session</small></span></div><div class="stat">${icons.shield}<span class="stat-proof">P-256 signatures · SHA-256<br>Verified locally in your browser</span></div></div></div><p class="sandbox-note">${icons.info}<span>This sandbox uses nontransferable test credits and centralized compute. A signed receipt proves issuer integrity, not LLM execution. <a href="/protocol#trust">Read the trust model.</a></span></p></section>
  <section class="history-section" aria-labelledby="history-heading"><div class="section-bar"><div class="section-heading"><span class="section-number">02</span><h2 id="history-heading">The paper trail</h2></div><span class="field-note" id="history-count">SESSION HISTORY</span></div><div id="history"><div class="history-empty"><span>No transactions yet. Every verified request will appear here.</span><span>Stored in this session only</span></div></div></section>
  <section class="principles" aria-label="Design principles"><article class="principle"><div class="principle-top">${icons.meter}<h3>Budget before compute.</h3></div><p>Every request has a fixed quote. Your agent checks the price and input before it authorizes a single test credit.</p></article><article class="principle"><div class="principle-top">${icons.receipt}<h3>Evidence with every output.</h3></div><p>Each receipt binds the input, output, price, and issuer. Export it and check the signature independently.</p></article><article class="principle"><div class="principle-top">${icons.spark}<h3>Useful without a new coin.</h3></div><p>A clear unit of account comes first. This release tests the interaction; real settlement needs a separate rail.</p></article></section>`;
}

function protocolMarkup() {
  return `<section class="page-hero"><p class="eyebrow">Protocol / first principles</p><h1>Trust less guesswork.<br><em>Keep better evidence.</em></h1><p class="hero-description">Cinder Rail explores the smallest useful unit of machine commerce: a priced request, explicit authorization, and a verifiable record of what happened.</p></section><div class="doc-layout"><aside class="doc-nav" aria-label="On this page"><a href="#flow"><span>01</span>The request loop</a><a href="#economics"><span>02</span>Units & economics</a><a href="#trust"><span>03</span>The trust boundary</a><a href="#architecture"><span>04</span>Architecture</a><a href="#beyond"><span>05</span>Beyond the sandbox</a></aside><div class="doc-content"><section class="doc-section" id="flow"><h2>One request. Four accountable steps.</h2><p>The browser plays the agent. It creates a temporary P-256 key pair, registers its public key, and receives nontransferable test credits. The private key stays in browser memory.</p><ol><li><strong>Quote.</strong> The agent asks for a service. The server returns HTTP 402 with a signed-message payload binding the session, service, input hash, price, cumulative spend, nonce, and expiry.</li><li><strong>Authorize.</strong> The browser checks the quote against the requested input, catalog price, available balance, and spending cap. It signs only the validated payload.</li><li><strong>Execute.</strong> The provider validates the signature and executes the requested hash or inference. A quote identifies one purchase; retrying the same completed purchase returns its receipt.</li><li><strong>Verify.</strong> The browser checks the issuer signature, receipt fields, and output hash. For SHA-256 it also recomputes the requested result independently.</li></ol><div class="callout"><p><strong>HTTP 402 is the interaction pattern.</strong> This release defines its own sandbox quote format. It does not claim compatibility with the x402 payment protocol.</p></div></section><section class="doc-section" id="economics"><h2>Stable accounting starts with an honest unit.</h2><p>There is no Cinder token. The sandbox records integer <code>sandbox-microUSD</code>: one million units display as one test dollar. These units have no cash value, cannot be withdrawn, and are not a stablecoin or a claim on compute reserves.</p><div class="equation">1 test USD = 1,000,000 sandbox-microUSD<br>request cost = published fixed service price<br>remaining balance = issued test credits − completed charges</div><p>SHA-256 costs <strong>10 units</strong> ($0.00001 test equivalent). A short Llama inference costs <strong>500 units</strong> ($0.0005 test equivalent). These are experiment prices, not a claim about provider costs or sustainable market prices.</p><p>Production pricing should quote a stable settlement asset against a precisely specified service: model version, input limits, output limits, hardware or execution class, and verification level. A FLOP is a measurement of work; it is not a universal unit of economic value. Memory, bandwidth, energy, utilization, and service guarantees all change cost.</p><p>A real deployment needs funded capacity and fee revenue sufficient to cover compute, verification, settlement, operations, and disputes. Token issuance does not remove those costs.</p></section><section class="doc-section" id="trust"><h2>Different proofs mean different things.</h2><p>A valid signature is useful evidence, but it cannot prove a provider ran a claimed model. Cinder Rail makes that distinction visible in every receipt.</p><table class="comparison"><thead><tr><th>Verification</th><th>What it establishes</th><th>This release</th></tr></thead><tbody><tr><td>Issuer signature</td><td>The receipt is intact and was signed by the key advertised by this server. The signature binds the input and output hashes.</td><td>Implemented</td></tr><tr><td>Recomputation</td><td>For SHA-256, the browser independently computes the expected result from the same input.</td><td>Implemented for hashing</td></tr><tr><td>TEE attestation</td><td>With a validated attestation chain, evidence can bind execution to specified enclave code and hardware assumptions.</td><td>Not implemented</td></tr><tr><td>ZK execution proof</td><td>Under the chosen proof system and circuit, evidence that a specific computation satisfies defined constraints.</td><td>Not implemented</td></tr><tr><td>Human identity</td><td>A key proves control of a key. It does not prove a unique human, authority, or trustworthy intent.</td><td>Not claimed</td></tr></tbody></table><p>The issuer key is fetched from this origin. That is a centralized trust root, not a third-party identity certification. Save or pin the public key when verifying receipts outside the application.</p><div class="callout"><p><strong>Privacy boundary.</strong> Request text is sent to the server; inference text is also processed by Cloudflare Workers AI. Requests and outputs may be retained in the sandbox session. Use non-sensitive sample text. Closing the page drops the browser key; server-side session expiry follows the returned <code>expiresAt</code>.</p></div></section><section class="doc-section" id="architecture"><h2>A small rail on existing infrastructure.</h2><p>The application uses Cloudflare Workers for HTTP handling, a Durable Object for persistent session accounting and issuer identity, and Workers AI for Meta Llama inference. Browser Web Crypto supplies agent signatures and independent receipt verification.</p><p>There is no new blockchain, consensus mechanism, validator set, or proprietary model. Test-credit accounting happens on the server. Low-latency authorization here must not be confused with irreversible settlement on a public chain.</p><p>Receipts use a canonical JSON representation with recursively sorted object keys. ECDSA P-256 signatures cover those exact UTF-8 bytes, and SHA-256 binds the original request and returned output. Private browser keys are never sent to the server.</p></section><section class="doc-section" id="beyond"><h2>The next release must earn its claims.</h2><p>Moving real value calls for a funded settlement channel, independent contract review, measured unit economics, operational controls, and a concrete refund and dispute model. A production design can use cumulative signed vouchers with an existing stable asset; only channel opening and final settlement need on-chain transactions.</p><p>Resource providers would compete on explicit price, latency, reliability, and evidence strength. Payment for completed work is the starting incentive. Slashing requires objectively provable faults, and subjective LLM output quality is not automatically such a fault.</p><p>Verifiable inference remains a separate engineering decision. TEEs introduce hardware and attestation trust. ZK proofs have model, arithmetic, and proving-cost constraints. Optimistic disputes require a well-defined deterministic computation and an economically viable challenger. This sandbox does not pretend one mechanism solves all three.</p><a class="outline-button" href="/developers">Explore the API ${icons.arrow}</a></section></div></div>`;
}

const starterCode = `// Native browser Web Crypto. Start with test credits only.
const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
);
const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
const session = await fetch('/api/sessions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ publicKey })
}).then(r => r.json());

const request = {
  sessionId: session.sessionId,
  service: 'hash', input: 'Hello, machine economy.'
};
const response = await fetch('/api/execute', {
  method: 'POST', headers: {
    'Content-Type': 'application/json',
    'X-Cinder-Session': session.sessionToken
  },
  body: JSON.stringify(request)
});
if (response.status !== 402) throw new Error('Expected a quote');
const { quote, signingPayload } = await response.json();

// Before signing: validate canonical payload, request hash, session,
// service, catalog price, cumulative spend, expiry, and budget.
// The live console implements these checks in /app.js.
console.log(quote, signingPayload);`;

function developersMarkup() {
  return `<section class="page-hero"><p class="eyebrow">Developers / the smallest integration</p><h1>One API.<br><em>A complete paper trail.</em></h1><p class="hero-description">Plain HTTP, standard browser cryptography, and inspectable receipts. Follow the running console from quote to verification, then build an agent of your own.</p></section><div class="doc-layout"><aside class="doc-nav" aria-label="On this page"><a href="#quickstart"><span>01</span>Start with a quote</a><a href="#endpoints"><span>02</span>API reference</a><a href="#signatures"><span>03</span>Signing & verification</a><a href="#failures"><span>04</span>Failures & retries</a><a href="#constraints"><span>05</span>Sandbox constraints</a></aside><div class="doc-content"><section class="doc-section" id="quickstart"><h2>No SDK dependency required.</h2><p>Use the same origin as this application. Your browser creates an ephemeral agent key; the service returns a session funded with 10,000 test units. The example below obtains a quote and stops before signing so that authorization checks remain explicit.</p><div class="code-wrap"><div class="code-label"><span>JAVASCRIPT · BROWSER CONSOLE</span><button class="copy-button" id="copy-code">Copy example</button></div><pre class="code-block"><code>${esc(starterCode)}</code></pre></div><p>The <a href="/app.js">complete console implementation</a> includes quote validation, spending limits, signature creation, receipt verification, and export. Inspect <a href="/api/catalog">the live service catalog</a> and <a href="/api/key">the issuer public key</a> directly.</p></section><section class="doc-section" id="endpoints"><h2>The API surface.</h2><div class="endpoint"><span class="method">GET</span><div>/api/catalog<small>Services, fixed prices, model identifiers, and maximum input lengths. Prices use integer sandbox-microUSD.</small></div></div><div class="endpoint"><span class="method">GET</span><div>/api/key<small>Issuer key ID and public P-256 JWK for receipt verification. Pin this key for an independent verifier.</small></div></div><div class="endpoint"><span class="method post">POST</span><div>/api/sessions<small>Send { publicKey: JWK }. Returns sessionId, sessionToken, balanceMicros, and expiresAt. Keep sessionToken private and send it as X-Cinder-Session for quotes and history reads.</small></div></div><div class="endpoint"><span class="method">GET</span><div>/api/sessions/:sessionId<small>Requires X-Cinder-Session with the private sessionToken. Returns balance and receipt history for reconciling an interrupted response.</small></div></div><div class="endpoint"><span class="method post">POST</span><div>/api/execute<small>Quote: send { sessionId, service, input } with X-Cinder-Session. HTTP 402 returns { quote, signingPayload }.</small><small>Execute: send { sessionId, quoteId, input, signature }. Returns receipt, signature, signingPayload, output, and balanceMicros.</small></div></div></section><section class="doc-section" id="signatures"><h2>Verify the bytes. Then verify the meaning.</h2><p>Signatures use <strong>ECDSA P-256 with SHA-256</strong>, encoded as unpadded base64url. Web Crypto signatures use the raw <code>r || s</code> representation. Sign and verify the UTF-8 bytes of the canonical JSON payload.</p><div class="code-wrap"><div class="code-label"><span>CANONICAL JSON</span></div><pre class="code-block"><code>function canonical(value) {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key =&gt;
    JSON.stringify(key) + ':' + canonical(value[key])
  ).join(',') + '}';
}</code></pre></div><p>A valid signature alone is insufficient. Check that the quote binds your session, selected service, original input hash, expected price, cumulative spending total, and unexpired validity period. Compare its canonical serialization to <code>signingPayload</code> before signing.</p><p>For receipts, repeat the binding checks, require the expected issuer key, verify the provider signature, and independently hash the returned output. Only deterministic SHA-256 requests in this release permit independent recomputation. Llama receipts establish issuer accountability, not proof of model execution.</p><p>Exported receipt bundles include the receipt, signature, output, canonical payload, and issuer public key. The bundle omits the original input, session token, and agent private key; receipt hashes can still reveal low-entropy input through guessing.</p></section><section class="doc-section" id="failures"><h2>Handle the unhappy path deliberately.</h2><table class="comparison"><thead><tr><th>Status</th><th>Meaning</th><th>Agent action</th></tr></thead><tbody><tr><td>402</td><td>A quote is ready, or test credit is insufficient; inspect the response body.</td><td>Validate a returned quote before authorizing. Do not blindly sign.</td></tr><tr><td>400 / 401 / 403</td><td>Invalid request, signature, or authorization.</td><td>Correct the request. Never change the signed bytes.</td></tr><tr><td>409</td><td>Stale or conflicting state, or an execution already in progress.</td><td>Reconcile session history before starting another purchase.</td></tr><tr><td>429</td><td>The sandbox is rate-limited.</td><td>Back off. Do not loop or create sessions to evade limits.</td></tr><tr><td>503</td><td>The requested service is temporarily unavailable.</td><td>Report the failure and reconcile. Hashing remains a useful independent test.</td></tr></tbody></table><p>A lost network response is not proof of failure. Query session history for the original quote ID, or retry the same signed purchase when appropriate. Creating a new quote may create a second purchase.</p></section><section class="doc-section" id="constraints"><h2>A deliberately bounded first release.</h2><p>This endpoint is a public experiment with finite capacity and service limits. Do not send secrets, personal data, or production workloads. Browser keys live in memory; refreshing starts a new browser context and drops access to the prior private key. The server expires sessions separately.</p><p>The API implements a custom HTTP 402 flow with nontransferable test credits. It is not x402-compatible, an escrow, a wallet, a decentralized marketplace, or a live stablecoin payment rail. See the <a href="/protocol#trust">trust model</a> for the exact verification guarantees.</p><a class="outline-button" href="/">Run your first request ${icons.arrow}</a></section></div></div>`;
}

function launchMarkup() {
  return `<section class="page-hero"><p class="eyebrow">Release 0.1 / an open starting point</p><h1>The machine economy<br>needs <em>receipts.</em></h1><p class="hero-description">Cinder Rail is live as a bounded public sandbox. Start with a tiny, complete transaction loop and make every claim checkable.</p></section><div class="launch-grid"><section class="launch-card"><p class="eyebrow">Available in this release</p><h2>Try the whole loop.</h2><ul class="launch-checklist"><li>${icons.check}<span>Browser agents with ephemeral P-256 signing keys</span></li><li>${icons.check}<span>Fixed quotes, local spending caps, and test-credit accounting</span></li><li>${icons.check}<span>SHA-256 compute and Meta Llama inference on Cloudflare</span></li><li>${icons.check}<span>Signed, downloadable receipts with browser verification</span></li><li>${icons.check}<span>Public API and a documented trust model</span></li></ul><a class="primary-button" href="/">Open the compute console ${icons.arrow}</a><p>No signup, wallet, token purchase, or real-money transfer. Public capacity is limited.</p></section><section class="launch-card"><p class="eyebrow">An invitation to builders</p><h2>Share something concrete.</h2><div class="announcement" id="announcement">Machines can buy compute. Can they show their work?

Cinder Rail is an open-source sandbox for budgeted agent requests and verifiable receipts: quote → sign → execute → verify.

Real cryptography, nontransferable test credits, and no new token. Signed receipts are not ZK proofs. Try the live console:</div><div class="launch-links"><button class="outline-button" id="copy-announcement">Copy announcement ${icons.arrow}</button><button class="outline-button" id="share-link">Copy launch link ${icons.arrow}</button></div><p class="inline-status" id="share-status" role="status"></p></section></div><section class="wide-callout"><div><h2>The useful question is what breaks.</h2><p>Try a spending cap below the service price. Change the request. Inspect an exported receipt. Integration feedback and independently reproduced failures are more valuable at this stage than a token launch.</p></div><a class="outline-button" href="/developers">Read the integration guide ${icons.arrow}</a></section><section class="principles" aria-label="What comes next"><article class="principle"><div class="principle-top">${icons.meter}<h3>Measure the economics.</h3></div><p>Service prices must cover real resource and verification costs before the rail handles real value.</p></article><article class="principle"><div class="principle-top">${icons.shield}<h3>Strengthen the evidence.</h3></div><p>Independent reviews, issuer key pinning, and explicit execution proofs are separate milestones.</p></article><article class="principle"><div class="principle-top">${icons.compute}<h3>Connect real settlement.</h3></div><p>Funded channels and an existing stable asset belong behind reviewed accounting and dispute rules.</p></article></section>`;
}

if (path === '/') { main.innerHTML = consoleMarkup(); startConsole(); }
else if (path === '/protocol') { main.innerHTML = protocolMarkup(); document.title = 'Protocol & trust model — Cinder Rail'; }
else if (path === '/developers') {
  main.innerHTML = developersMarkup(); document.title = 'Developers — Cinder Rail';
  document.getElementById('copy-code').addEventListener('click', async event => { const button = event.currentTarget; try { await copy(starterCode); button.textContent = 'Copied'; } catch {} });
} else if (path === '/launch') {
  main.innerHTML = launchMarkup(); document.title = 'Launch — Cinder Rail';
  document.getElementById('copy-announcement').addEventListener('click', async () => { await copy(document.getElementById('announcement').textContent + '\n' + location.origin); document.getElementById('share-status').textContent = 'Announcement copied. Ready to share in your own voice.'; });
  document.getElementById('share-link').addEventListener('click', async () => { await copy(location.origin); document.getElementById('share-status').textContent = 'Live sandbox link copied.'; });
} else {
  document.title = 'Page not found — Cinder Rail';
  main.innerHTML = '<section class="page-hero"><p class="eyebrow">404 / off the rail</p><h1>This stop does not exist.</h1><p class="hero-description">The compute console is one step away.</p><a class="route-return" href="/">Return to the console →</a></section>';
}
if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());

async function copy(value) {
  try { await navigator.clipboard.writeText(value); toast('Copied to clipboard'); }
  catch { const textarea = document.createElement('textarea'); textarea.value = value; textarea.style.position = 'fixed'; textarea.style.top = '0'; document.body.append(textarea); textarea.focus(); textarea.select(); const ok = document.execCommand('copy'); textarea.remove(); if (!ok) { toast('Clipboard unavailable. Select and copy the text directly.'); throw new Error('Clipboard unavailable'); } toast('Copied to clipboard'); }
}
function toast(message) { document.querySelector('.toast')?.remove(); const element = document.createElement('div'); element.className = 'toast'; element.setAttribute('role','status'); element.textContent = message; document.body.append(element); setTimeout(() => element.remove(), 3500); }

async function startConsole() {
  const state = { services: [], service: 'hash', key: null, issuer: null, session: null, balance: 0, spent: 0, records: [], running: false, ready: false, activeStep: -1, pendingPurchase: null, verificationFailed: false };
  const ui = Object.fromEntries(['connection','service-options','input-hint','input-type','request-input','input-count','budget','run','run-note','reset','session-label','error','result','result-state','trace','balance','spend','verified-count','history','history-count','request-form'].map(id => [id, document.getElementById(id)]));
  const initialResult = ui.result.innerHTML;

  async function request(url, body, expected402 = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    let response;
    const headers = body ? {'Content-Type':'application/json'} : {};
    if (state.session?.sessionToken && (url === '/api/execute' || url.startsWith('/api/sessions/'))) headers['X-Cinder-Session'] = state.session.sessionToken;
    try { response = await fetch(url, {method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, cache: 'no-store'}); }
    catch (error) { const failure = new Error(error.name === 'AbortError' ? 'The request timed out. Checking whether a receipt was created.' : 'Connection interrupted. Check your connection and try again.'); failure.network = true; throw failure; }
    finally { clearTimeout(timer); }
    let data;
    try { data = await response.json(); } catch { throw new Error('The server returned an unexpected response. Please try again shortly.'); }
    if (!response.ok && !(expected402 && response.status === 402 && data.quote)) {
      const suffix = response.status === 429 ? ' Please wait before trying again.' : response.status === 503 ? ' This service is temporarily unavailable.' : response.status === 409 ? ' The session changed; try a fresh request after the current one completes.' : '';
      const error = new Error((data.message || data.error || 'Request failed.') + suffix); error.status = response.status; throw error;
    }
    return { data, status: response.status };
  }

  function showError(message) { ui.error.textContent = message; ui.error.hidden = false; }
  function clearError() { ui.error.textContent = ''; ui.error.hidden = true; }
  function setConnection(text, status = '') { ui.connection.className = 'connection' + (status ? ' ' + status : ''); ui.connection.lastElementChild.textContent = text; }
  function setTrace(index, status) { const step = ui.trace.children[index]; if (step) step.dataset.state = status; if (status === 'active') state.activeStep = index; }
  function resetTrace() { for (const step of ui.trace.children) step.dataset.state = 'idle'; state.activeStep = -1; }
  function busy(value) {
    state.running = value; ui.run.disabled = value || !state.ready || state.verificationFailed; ui.reset.disabled = value || !state.session;
    ui['request-input'].disabled = value; ui.budget.disabled = value;
    for (const button of ui['service-options'].querySelectorAll('button')) button.disabled = value || state.services.find(service => service.id === button.dataset.service)?.available === false;
    ui.run.innerHTML = value ? '<span class="spinner" aria-hidden="true"></span><span>Authorizing & executing…</span>' : '<span>' + (state.pendingPurchase ? 'Check interrupted request' : 'Run paid request') + '</span>' + icons.arrow;
    ui['request-form'].setAttribute('aria-busy', String(value));
  }
  function updateInputCount() { const selected = state.services.find(service => service.id === state.service); const max = selected?.maxInputChars || 4000; ui['input-count'].textContent = ui['request-input'].value.length.toLocaleString() + ' / ' + max.toLocaleString(); }
  function renderServices() {
    ui['service-options'].innerHTML = state.services.map(service => `<button type="button" class="service-option" data-service="${esc(service.id)}" aria-pressed="${service.id === state.service}" ${service.available === false ? 'disabled' : ''}><span class="service-name">${service.id === 'hash' ? icons.hash : icons.spark}${esc(service.name)}</span><span class="service-price">${service.available === false ? 'Temporarily unavailable' : esc(amount(service.amountMicros)) + ' / request · test'}</span></button>`).join('');
    for (const button of ui['service-options'].querySelectorAll('button')) button.addEventListener('click', () => {
      if (state.running) return;
      const prior = state.service; state.service = button.dataset.service; renderServices();
      const selected = state.services.find(service => service.id === state.service);
      ui['request-input'].maxLength = selected.maxInputChars;
      ui['input-hint'].textContent = state.service === 'hash' ? 'Create a verifiable SHA-256 fingerprint of your text.' : 'A short reply from Meta Llama. Do not include sensitive information.';
      ui['input-type'].textContent = state.service === 'hash' ? 'PLAIN TEXT' : 'LLAMA PROMPT';
      if (prior !== state.service && ['The future of commerce is a conversation between machines.', 'In one sentence, explain why an AI agent needs a spending budget.'].includes(ui['request-input'].value)) ui['request-input'].value = state.service === 'hash' ? 'The future of commerce is a conversation between machines.' : 'In one sentence, explain why an AI agent needs a spending budget.';
      updateInputCount(); clearError();
    });
  }
  function updateStats() {
    ui.balance.innerHTML = (state.session ? esc(amount(state.balance)) : '—') + '<small>test USD</small>';
    ui.spend.innerHTML = (state.session ? esc(amount(state.spent)) : '—') + '<small>test USD</small>';
    ui['verified-count'].innerHTML = state.records.length + '<small>this session</small>';
    ui['session-label'].textContent = state.session ? 'Agent / ' + short(state.session.sessionId) : 'Ephemeral agent / not started';
    ui['history-count'].textContent = state.records.length ? state.records.length + (state.records.length === 1 ? ' VERIFIED REQUEST' : ' VERIFIED REQUESTS') : 'SESSION HISTORY';
  }
  function renderHistory() {
    if (!state.records.length) { ui.history.innerHTML = '<div class="history-empty"><span>No transactions yet. Every verified request will appear here.</span><span>Stored in this session only</span></div>'; return; }
    ui.history.innerHTML = '<table class="history-table"><caption class="sr-only">Verified requests in this browser session</caption><thead><tr><th scope="col">RECEIPT</th><th scope="col">SERVICE</th><th scope="col">TEST COST</th><th scope="col">STATUS</th></tr></thead><tbody>' + state.records.slice().reverse().map((record, i) => `<tr><td><button class="history-button" data-record="${state.records.length - i - 1}" aria-label="View receipt ${esc(record.receipt.id)}">${esc(short(record.receipt.id))}</button></td><td>${record.receipt.service === 'hash' ? 'SHA-256' : 'Llama'}</td><td class="mono">${esc(amount(record.receipt.amountMicros))}</td><td><span class="verified-label">${icons.check}Verified</span></td></tr>`).join('') + '</tbody></table>';
    for (const button of ui.history.querySelectorAll('[data-record]')) button.addEventListener('click', () => { if (state.running) return; renderReceipt(state.records[Number(button.dataset.record)]); ui['result-state'].scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); });
  }
  function renderReceipt(record) {
    const r = record.receipt;
    ui.result.className = 'receipt-result';
    ui['result-state'].className = 'result-state verified';
    ui['result-state'].innerHTML = icons.check + (record.deterministic ? 'SIGNATURE + RESULT VERIFIED' : 'ISSUER SIGNATURE VERIFIED');
    ui.result.innerHTML = `<p class="output-label">${r.service === 'hash' ? 'COMPUTE OUTPUT / SHA-256' : 'COMPUTE OUTPUT / META LLAMA'}</p><pre class="output-text" tabindex="0">${esc(record.output)}</pre><dl class="receipt-meta"><dt>Receipt ID</dt><dd>${esc(short(r.id))}</dd><dt>Authorized cost</dt><dd>${esc(amount(r.amountMicros))} test USD</dd><dt>Issuer key</dt><dd>${esc(short(r.keyId))}</dd><dt>Issued</dt><dd>${esc(new Date(r.issuedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</dd></dl><div class="receipt-actions"><span class="verified-label">${icons.shield}${record.deterministic ? 'Recomputed in your browser' : 'Signed receipt · not an execution proof'}</span><button type="button" class="outline-button" id="export-receipt">${icons.download}Export receipt</button></div>`;
    document.getElementById('export-receipt').addEventListener('click', () => {
      const bundle = {format:'cinder-rail-receipt-v1',verificationNotice:'Issuer signature proves receipt integrity. It does not prove LLM execution. Sandbox credits have no monetary value.',issuerPublicKey:state.issuer.publicKey,receipt:r,signature:record.signature,signingPayload:record.signingPayload,output:record.output};
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)], {type:'application/json'}));
      const link = document.createElement('a'); link.href = url; link.download = 'cinder-receipt-' + String(r.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80) + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('Receipt exported with issuer public key');
    });
  }
  async function newSession() {
    state.key = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify']);
    const publicKey = await crypto.subtle.exportKey('jwk',state.key.publicKey);
    const {data} = await request('/api/sessions',{publicKey});
    if (!data.sessionId || typeof data.sessionToken !== 'string' || !data.sessionToken || !Number.isSafeInteger(data.balanceMicros) || !Number.isFinite(Date.parse(data.expiresAt))) throw new Error('The server returned an invalid session. Please try again.');
    state.session = data; state.balance = data.balanceMicros; state.spent = 0; updateStats();
  }
  async function verifyRecord(data, quote, inputHash) {
    const r = data.receipt;
    if (!r || typeof data.output !== 'string' || typeof data.signature !== 'string' || data.signature.length > 256) throw new Error('The receipt is incomplete. Verification failed.');
    const payload = canonical(r);
    if (typeof data.signingPayload !== 'string' || data.signingPayload !== payload) throw new Error('Receipt serialization does not match the signed payload.');
    if (r.sessionId !== state.session.sessionId || r.quoteId !== quote.id || r.service !== quote.service || r.inputHash !== inputHash || r.amountMicros !== quote.amountMicros || r.cumulativeMicros !== quote.cumulativeMicros || r.keyId !== state.issuer.keyId || r.mode !== 'sandbox' || r.unit !== 'sandbox-microUSD' || r.verification !== 'signed-receipt' || !Number.isFinite(Date.parse(r.issuedAt))) throw new Error('Receipt fields do not match the authorized request. Verification failed.');
    const service = state.services.find(service => service.id === quote.service);
    if (service?.model && r.model !== service.model) throw new Error('Receipt model does not match the selected service.');
    const valid = await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},state.issuer.verifier,fromBase64(data.signature),bytes(payload));
    if (!valid) throw new Error('Issuer signature verification failed. Do not trust this receipt.');
    if (await digest(data.output) !== r.outputHash) throw new Error('Output hash verification failed. The output does not match the signed receipt.');
    if (quote.service === 'hash' && data.output !== inputHash) throw new Error('Independent SHA-256 recomputation failed.');
    return {...data,signingPayload:payload,deterministic:quote.service === 'hash'};
  }
  async function recoverPurchase(quote, inputHash) {
    const {data} = await request('/api/sessions/' + encodeURIComponent(state.session.sessionId));
    const saved = data.receipts?.find(record => record.receipt?.quoteId === quote.id);
    if (!saved) return null;
    const record = await verifyRecord(saved, quote, inputHash);
    record.balanceMicros = data.balanceMicros;
    return record;
  }
  function acceptRecord(record) {
    if (!Number.isSafeInteger(record.balanceMicros) || record.balanceMicros < 0) throw new Error('The updated test balance is invalid.');
    state.balance = record.balanceMicros; state.spent = record.receipt.cumulativeMicros; state.pendingPurchase = null;
    if (!state.records.some(old => old.receipt.id === record.receipt.id)) state.records.push(record);
    renderReceipt(record); updateStats(); renderHistory(); setConnection('Rail operational');
    ui['run-note'].textContent = 'Receipt verified. Your next request stays within the same budget cap.';
  }

  ui['request-input'].addEventListener('input',updateInputCount); updateInputCount();
  ui.reset.addEventListener('click', () => {
    if (state.running) return;
    state.key = null; state.session = null; state.balance = 0; state.spent = 0; state.records = []; state.pendingPurchase = null; state.verificationFailed = false;
    ui.result.className = 'empty-result'; ui.result.innerHTML = initialResult; ui['result-state'].className = 'result-state'; ui['result-state'].textContent = 'AWAITING REQUEST';
    ui['run-note'].textContent = 'A browser agent signs. No wallet or account needed.';
    resetTrace(); clearError(); updateStats(); renderHistory(); busy(false); toast('Browser agent cleared. Your next run creates a new session.');
  });

  ui['request-form'].addEventListener('submit', async event => {
    event.preventDefault(); if (state.running || !state.ready) return;
    clearError();
    if (state.pendingPurchase) {
      busy(true); const pending = state.pendingPurchase; setTrace(2,'active'); ui['result-state'].textContent = 'CHECKING ORIGINAL PURCHASE';
      try {
        let record = await recoverPurchase(pending.quote,pending.inputHash);
        if (!record) {
          const replay = await request('/api/execute',{sessionId:state.session.sessionId,quoteId:pending.quote.id,input:pending.input,signature:pending.signature});
          record = await verifyRecord(replay.data,pending.quote,pending.inputHash);
        }
        acceptRecord(record); for (let i=0;i<4;i++) setTrace(i,'done');
      } catch (error) {
        if (error.status && ![409,429].includes(error.status)) state.pendingPurchase = null;
        showError(error.message + (state.pendingPurchase ? ' Use this button to check the original request; it will not create a second purchase.' : ' No new purchase was created.'));
        ui['result-state'].className = 'result-state failed'; ui['result-state'].textContent = 'REQUEST NOT VERIFIED'; setTrace(2,'error');
      } finally { busy(false); }
      return;
    }
    const input = ui['request-input'].value;
    const service = state.services.find(service => service.id === state.service);
    const capText = ui.budget.value.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(capText)) { showError('Enter a nonnegative budget with up to six decimal places.'); return; }
    const capParts = capText.split('.'); const cap = Number(capParts[0]) * 1000000 + Number((capParts[1] || '').padEnd(6,'0'));
    if (!Number.isSafeInteger(cap)) { showError('The spending cap is too large. Choose a smaller test amount.'); return; }
    if (!input.trim() || input.length > service.maxInputChars) { showError('Enter between 1 and ' + service.maxInputChars.toLocaleString() + ' characters for this service.'); return; }
    if (service.amountMicros > cap) { showError('Budget protected: this service costs ' + amount(service.amountMicros) + ' test USD, above your ' + amount(cap) + ' cap. No request was authorized.'); return; }
    busy(true); resetTrace(); let quote = null; let inputHash = ''; let submitted = false;
    ui['result-state'].className = 'result-state'; ui['result-state'].textContent = 'PREPARING AGENT';
    try {
      if (!state.session) await newSession();
      if (Date.parse(state.session.expiresAt) <= Date.now()) throw new Error('This sandbox session expired. Select New session to create another agent.');
      if (state.balance < service.amountMicros) throw new Error('This session has insufficient test credits. Select New session to begin a new experiment.');
      setTrace(0,'active'); ui['result-state'].textContent = 'REQUESTING QUOTE';
      inputHash = await digest(input);
      const quoted = await request('/api/execute',{sessionId:state.session.sessionId,service:service.id,input},true);
      if (quoted.status !== 402) throw new Error('The provider did not return the expected HTTP 402 quote.');
      quote = quoted.data.quote;
      if (canonical(quote) !== quoted.data.signingPayload || quote.sessionId !== state.session.sessionId || quote.service !== service.id || quote.inputHash !== inputHash || quote.amountMicros !== service.amountMicros || !Number.isSafeInteger(quote.amountMicros) || quote.amountMicros < 0 || quote.amountMicros > cap || quote.cumulativeMicros !== state.spent + quote.amountMicros || !quote.id || !quote.nonce || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) throw new Error('Quote validation failed. The agent refused to sign an unexpected, expired, or over-budget request.');
      setTrace(0,'done'); setTrace(1,'active'); ui['result-state'].textContent = 'SIGNING AUTHORIZATION';
      const signature = toBase64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},state.key.privateKey,bytes(quoted.data.signingPayload)));
      setTrace(1,'done'); setTrace(2,'active'); ui['result-state'].textContent = service.id === 'hash' ? 'COMPUTING SHA-256' : 'WAITING FOR META LLAMA';
      submitted = true; state.pendingPurchase = {quote,input,inputHash,signature};
      const executed = await request('/api/execute',{sessionId:state.session.sessionId,quoteId:quote.id,input,signature});
      setTrace(2,'done'); setTrace(3,'active'); ui['result-state'].textContent = 'VERIFYING RECEIPT';
      let record;
      try { record = await verifyRecord(executed.data,quote,inputHash); } catch (error) { state.verificationFailed = true; throw error; }
      acceptRecord(record); setTrace(3,'done');
    } catch (error) {
      let recovered = false;
      if (submitted && quote && (error.network || [409,503].includes(error.status))) {
        ui['result-state'].textContent = 'RECONCILING SESSION';
        try { const record = await recoverPurchase(quote,inputHash); if (record) { acceptRecord(record); for (let i=0;i<4;i++) setTrace(i,'done'); recovered = true; toast('Recovered and verified the completed receipt.'); } } catch { /* Keep the original error visible; do not initiate a second purchase. */ }
      }
      if (!recovered) {
        if (!error.network && error.status !== 409) state.pendingPurchase = null;
        showError((error.message || 'The request could not be completed.') + (state.pendingPurchase ? ' Check the original request before making another purchase.' : '') + (state.verificationFailed ? ' This agent is paused. Start a new session to continue.' : ''));
        if (state.activeStep >= 0) setTrace(state.activeStep,'error'); ui['result-state'].className = 'result-state failed'; ui['result-state'].textContent = 'REQUEST NOT VERIFIED';
      }
    } finally { busy(false); }
  });

  try {
    if (!window.isSecureContext || !crypto.subtle) throw new Error('Browser cryptography requires HTTPS or localhost. Open the secure deployment to run a request.');
    const results = await Promise.all([request('/api/catalog'),request('/api/key')]);
    const catalog = results[0].data; const issuer = results[1].data;
    if (catalog.unit !== 'sandbox-microUSD' || !Array.isArray(catalog.services) || !catalog.services.length || !catalog.services.every(service => ['hash','inference'].includes(service.id) && typeof service.name === 'string' && Number.isSafeInteger(service.amountMicros) && service.amountMicros >= 0 && Number.isSafeInteger(service.maxInputChars) && service.maxInputChars > 0)) throw new Error('The service catalog could not be validated.');
    state.services = catalog.services; state.service = state.services[0].id;
    state.issuer = {...issuer,verifier:await crypto.subtle.importKey('jwk',issuer.publicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify'])};
    state.ready = true; renderServices(); busy(false); setConnection('Rail operational'); updateInputCount();
  } catch (error) { setConnection('Connection unavailable','error'); showError(error.message + ' Reload the page to reconnect.'); ui['service-options'].innerHTML = '<p class="input-hint">The live catalog is unavailable.</p>'; }
}
