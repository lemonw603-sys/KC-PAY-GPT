import assert from 'node:assert/strict';import {createFixedWindowRateLimit} from '../../v1/src/app/fixed-window-rate-limit.js';
let time=0;const guard=createFixedWindowRateLimit({limit:60,windowMs:15*60_000,now:()=>time});let accepted=0,code;
const res={setHeader(){},status(n){code=n;return this},json(){}};
for(let i=0;i<60;i++){time=i*10_000;guard({ip:'fixture'},res,()=>accepted++);}
time=600_000;guard({ip:'fixture'},res,()=>accepted++);assert.equal(accepted,60);assert.equal(code,429);
console.log(JSON.stringify({mode:'ACTUAL_RATE_LIMIT_OFFLINE',acceptedPolls:accepted,nextRequestAtSeconds:time/1000,status:code,note:'Default shared write limiter: 10s read polling consumes same-IP write budget; app defaults, not live 429 reproduction'},null,2));
