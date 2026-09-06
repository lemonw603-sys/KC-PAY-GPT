import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const src=fs.readFileSync('v1/public/assets/customer.js','utf8');const a=src.indexOf('  function stopPoll()');const b=src.indexOf('  // ---------------- 填写页',a);
let callback,resolve;const painted=[];const promise=new Promise(r=>{resolve=r});
const ctx={pollTimer:null,pollStart:Date.now(),Date,document:{hidden:false},el:{pollNote:{}},setTimeout(fn){callback=fn;return 1;},clearTimeout(){},api:{getStatus:()=>promise},renderStatus:o=>painted.push(o.publicNo)};
vm.createContext(ctx);vm.runInContext(src.slice(a,b),ctx);
ctx.schedulePoll('old-order',{terminal:false,poll:100});const inflight=callback();ctx.stopPoll();painted.push('new-order');resolve({order:{publicNo:'old-order'}});await inflight;
assert.deepEqual(painted,['new-order','old-order']);console.log(JSON.stringify({mode:'ACTUAL_POLL_FUNCTION_FAKE_NETWORK',renderOrder:painted,bug:'Stopping timer does not invalidate an in-flight response'},null,2));
