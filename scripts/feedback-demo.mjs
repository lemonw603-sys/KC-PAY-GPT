// Local interaction demo: shipped frontend, in-memory fixtures, NO DB/provider/worker.
import express from '../v1/node_modules/express/index.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const app = express(), port = 8805;
const root = fileURLToPath(new URL('../v1/public/', import.meta.url));
const now = () => new Date().toISOString();
let mode='normal', method='API', source='backup', updatedAt=now(), saved=false;
const sources=[{id:'primary',accountCode:'demo-primary',label:'HNSKJ（测试）',providerKind:'hnskj'},
  {id:'backup',accountCode:'demo-backup',label:'highvcc（测试）',providerKind:'highvcc'}];
const rigs=()=>sources.map((s,i)=>({...s,providerAccountId:s.id,providerCode:s.accountCode,operationalEnabled:true,
  walletLiveOnly:!!i,walletBalance:i?null:'38.73',walletFloor:'30',walletSyncedAt:now(),stockAvailable:2,stockTarget:2,
  inStock:2,total:2,inUse:0,openedToday:0,tokenExpiredAlert:mode==='expired',
  byProduct:[{label:'Plus',used:1,stockAvailable:2,autoReplenished:true}],spentToday:'0',circuitState:'CLOSED',lastFullSnapshotAt:now()}));
const cards=()=>sources.flatMap((s,i)=>[0,1].map(n=>({providerAccountId:s.id,providerCardId:`demo-${i}-${n}`,
  last4:String(1000+i*100+n),providerLabel:s.label,currentBalance:n?'50.00':'16.00',lastSyncedAt:updatedAt,
  createdAt:updatedAt,category:'READY',inventoryStatus:'AVAILABLE',usedCapacity:n?0:1,maxCapacity:3,issueFee:'0.50'})));
app.use((req,res,next)=>{
  if(req.headers.host!==`127.0.0.1:${port}` && req.headers.host!==`localhost:${port}`)return res.sendStatus(403);
  res.set('Cache-Control','no-store');
  res.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'");next();
});
app.use(express.json({limit:'16kb'}));
app.get('/demo/state',(_req,res)=>res.json({mode,method,source}));
app.post('/demo/scenario',(req,res)=>{
  if(!['normal','expired','save-read-failed','switch-unknown'].includes(req.body.mode))return res.sendStatus(400);
  mode=req.body.mode;method='API';source='backup';saved=false;updatedAt=now();res.json({ok:true});
});
app.get('/api/v1/admin/session',(_req,res)=>res.json({authenticated:true}));
app.get('/api/v1/admin/overview',(_req,res)=>res.json({metrics:{todayOrders:0,completedOrders:0},
  decisions:{acceptNewOrders:true,dispatchNewRecharges:true,browserPaymentWritesEnabled:false},
  providerHealth:{rechargeMethod:method,accountBalance:'38.73',currency:'USD'},cardStockByProvider:rigs()}));
app.get('/api/v1/admin/card-sources',(_req,res)=>res.json({browserProviderAccountId:source,browserSelectionVersion:1,
  sources:sources.map(s=>({...s,supportsBrowserRecharge:true,operationalEnabled:true}))}));
app.get('/api/v1/admin/card-sources/browser/takeover-estimate',(_req,res)=>res.json({count:0}));
app.post('/api/v1/admin/card-sources/browser/current',(req,res)=>{
  if(!sources.some(s=>s.id===req.body.providerAccountId))return res.status(400).json({error:'invalid_source'});
  source=req.body.providerAccountId;res.json({actualTakeoverCount:0});
});
app.post('/api/v1/admin/operations/default-recharge-method',(req,res)=>{
  if(!['API','BROWSER'].includes(req.body.method))return res.status(400).json({error:'invalid_method'});
  method=req.body.method;
  if(mode==='switch-unknown')return res.status(503).json({error:'demo_response_lost'});
  res.json({ok:true});
});
app.get('/api/v1/admin/card-stock',(_req,res)=>res.json({byProvider:rigs(),cards:cards(),jobs:[],catalog:{}}));
app.get('/api/v1/admin/card-retirement/candidates',(_req,res)=>res.json({due:[],notYetDue:[]}));
app.get('/api/v1/admin/alerts',(_req,res)=>res.json({alerts:mode==='expired'?[{id:'demo-expired',type:'PROVIDER_TOKEN_EXPIRED',message:'测试卡台登录已失效，请更新测试 token',createdAt:updatedAt}]:[]}));
app.get('/api/v1/admin/backup-cards/highvcc/status',(_req,res)=>{
  if(saved&&mode==='save-read-failed')return res.status(503).json({error:'demo_status_read_failed'});
  res.json({configured:true,updatedAt});
});
app.get('/api/v1/admin/backup-cards/highvcc/wallet',async(_req,res)=>{
  await new Promise(r=>setTimeout(r,600));
  if(mode==='expired')return res.status(503).json({error:'highvcc_token_expired'});
  res.json({usdBalance:'41.49',usdDeposit:'20.00',usdConsume:'101.00'});
});
app.post('/api/v1/admin/backup-cards/highvcc/token',(_req,res)=>{
  // Ignore input: do not store, log, forward, or validate real credentials.
  saved=true;updatedAt=now();if(mode==='expired')mode='normal';res.json({configured:true,updatedAt});
});
app.get('/api/v1/admin/backup-cards/highvcc/ranges',(_req,res)=>res.json({ranges:[]}));
app.get('/api/v1/admin/provider-routes',(_req,res)=>res.json({routes:[],providers:[]}));
app.get('/api/v1/admin/card-intake',(_req,res)=>res.json({items:[],cards:[],summary:{}}));
app.get('/api/v1/admin/reconciliation/daily',(_req,res)=>res.json({discrepancyCount:0,pendingRegistrationCount:0,unverifiableAmountCount:0,persistentCount:0}));
app.get('/api/v1/admin/reconciliation-cases',(_req,res)=>res.json({cases:[],total:0}));
app.get('/api/v1/admin/orders',(_req,res)=>res.json({orders:[],total:0}));
app.post('/api/v1/admin/orders/search',(_req,res)=>res.json({orders:[],total:0}));
app.use('/api',(_req,res)=>res.status(403).json({error:'DEMO_ONLY_此操作未接通'}));
const banner=`<section id="demo-tools" style="padding:14px;background:var(--wb-warn-soft);border-bottom:1px solid var(--wb-bd);position:relative;z-index:20">
<strong>可交互 Demo · 纯测试数据 · 不连接真实业务</strong>
<p>先试工作台的“刷新余额”和API／浏览器切换。更新登录时只填 demo-token，不要填真实凭据。</p>
<details><summary>模拟故障（可不操作，正式系统没有这一项）</summary>
<label style="display:block;margin-top:8px">模拟情况 <select id="demo-scenario"><option value="normal">正常使用</option><option value="expired">模拟登录过期，查不到余额</option><option value="save-read-failed">模拟token存好了，但状态没读到</option><option value="switch-unknown">模拟切换好了，但回复丢了</option></select></label>
<small>选一种情况，亲手试提示是否看得懂；选择后会重置测试状态。其他模块未开放。</small></details></section>`;
app.get(['/','/admin','/admin/'],async(_req,res)=>{
  let html=await readFile(root+'admin/index.html','utf8');
  html=html.replace(/<body([^>]*)>/,`<body$1>${banner}`).replace('</body>','<script src="/demo.js"></script></body>');
  res.type('html').send(html);
});
app.get('/demo.js',(_req,res)=>res.type('js').send(`
document.querySelector('#demo-scenario').onchange=async e=>{await fetch('/demo/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:e.target.value})});location.reload();};
fetch('/demo/state').then(r=>r.json()).then(s=>document.querySelector('#demo-scenario').value=s.mode);
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.nav-item').forEach(e=>{if(!['overview','stock'].includes(e.dataset.view)){e.disabled=true;e.title='本次只演示工作台和卡片';}});
  const token=document.querySelector('#highvcc-token-input');token.placeholder='只填 demo-token，不要填真实凭据';
  document.querySelectorAll('a[href^="javascript:"]').forEach(e=>{e.removeAttribute('href');e.textContent='书签登录在演示中不开放';});
});
document.addEventListener('click',e=>{if(e.target.closest('#highvcc-open-site,a[href^="http"],#logout-button')){e.preventDefault();e.stopImmediatePropagation();alert('演示不连接外部卡台，请使用 demo-token。');}},true);
`));
app.use(express.static(root));
const server=app.listen(port,'127.0.0.1',()=>console.log(`FEEDBACK_DEMO_READY http://127.0.0.1:${port}/admin/ (memory only; no providers)`));
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
