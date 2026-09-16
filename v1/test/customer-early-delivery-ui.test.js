import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

test('customer sees real payment preparation then success without renewal details or waiting for cleanup',async()=>{
 const b=await chromium.launch({headless:true});let calls=0;
 try{
  const page=await b.newPage();
  await page.route('http://customer.test/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==='/api/v1/orders/status'){
    calls++;const success=calls>1;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({order:{
     publicNo:'PJV1-12345678901234567890',status:success?'SUCCESS':'ACTIVATING',productCode:'chatgpt_plus',planType:'plus',
     updatedAt:new Date().toISOString(),stage:{index:success?9:6,total:9,code:success?'SUBSCRIPTION_ACTIVE':'PAYMENT_SUBMITTING',
      label:success?'订阅成功':'正在准备并提交支付',floor:success?99:62,ceiling:success?100:94,typicalMs:58000,since:new Date().toISOString()},
    }})});
   }
   const files={'/':'index.html','/assets/customer.js':'assets/customer.js','/assets/customer.css':'assets/customer.css'};
   if(!files[path])return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../public/'+files[path],import.meta.url),'utf8')});
  });
  await page.goto('http://customer.test/');await page.locator('#nav-query').click();
  await page.locator('#query-input').fill('PJV1-12345678901234567890');await page.locator('#query-submit').click();
  await page.waitForFunction(()=>document.querySelector('#stage-name').textContent==='正在准备并提交支付');
  await page.waitForFunction(()=>document.querySelector('#stage-name').textContent==='订阅成功',{},{timeout:5000});
  assert.equal(await page.locator('#ring-num').isHidden(),true);
  assert.doesNotMatch(await page.locator('#view-run').innerText(),/取消续费/);
  const end=calls;await page.waitForTimeout(2200);assert.equal(calls,end,'successful delivery stops customer polling while backend may still work');
 }finally{await b.close()}
});
