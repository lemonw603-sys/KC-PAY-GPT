import {redactSensitiveText} from '../security/redaction.js';

export function usableBarkEmail(value) {
  const email=typeof value==='string'?value.trim():'';
  return email.length<=320&&/^[^\s@<>\p{C}]+@[^\s@<>\p{C}]+\.[^\s@<>\p{C}]+$/u.test(email)?email:null;
}

// Phone-only presentation: never mutate the original alert or infer a payment outcome.
// Recognize only existing producer contracts; unknown formats retain their full safe text.
export function presentBarkNotification(delivery) {
  const title=redactSensitiveText(String(delivery.title||''));
  const message=redactSensitiveText(String(delivery.message||''));
  const order=message.match(/^订单 ([A-Za-z0-9_-]+)｜([\s\S]*)$/);
  const email=order&&delivery.publicNo&&order[1]!==delivery.publicNo?null:usableBarkEmail(delivery.customerEmail);
  const base={title,message,severity:delivery.severity,...(email?{customerEmail:email}:{})};
  const identity=email?`账号 ${email}`:order?`订单 ${order[1]}`:null;
  const hasMoney=/(?:[$¥€£]\s*-?\d|\d(?:[\d.,]*\d)?\s*(?:USD|PHP|HKD|CNY|EUR|美元|港币|人民币))/i.test(message);
  const withOrder=(heading,body)=>({ ...base,title:heading,message:`${identity}\n${body}` });
  if(delivery.type==='PROVIDER_BALANCE_CHANGED'){
    const balance=message.match(/^(.+?)余额由 (-?\d+(?:\.\d+)?) ([A-Z]{3}) 变为 (-?\d+(?:\.\d+)?) \3[。.]?$/);
    if(balance){
      const compact=n=>n.includes('.')?n.replace(/0+$/,'').replace(/\.$/,''):n;
      return {...base,title:`${balance[1]}余额更新`,message:`${compact(balance[2])} → ${compact(balance[4])} ${balance[3]}`};
    }
  }
  if(delivery.type==='PROVIDER_TOKEN_EXPIRED'){
    const provider=message.match(/^(.+?) 的访问 token 已失效（[^）]+）。/);
    if(provider)return {...base,title:'卡台登录失效',message:`${provider[1]}：同步、开卡及付款核对受影响。\n请在后台更新登录。`};
  }
  if(delivery.type==='BROWSER_HUMAN_VERIFICATION'&&order&&!hasMoney)
    return withOrder('需要人机验证','请在浏览器完成验证，勿重复付款。');
  if(delivery.type==='BROWSER_HUMAN_REQUIRED'&&order&&!hasMoney){
    if(order[2].startsWith('客户已交付，内部取消续费或对账未完成'))
      return withOrder('已交付，收尾待处理','请核查取消续费或对账，勿重新付款。');
    if(order[2].startsWith('付款后系统自己查了几次仍无法确定结果'))
      return withOrder('付款结果待核实','请核对账号与卡扣款，再到后台确认。勿重复付款。');
  }
  if(delivery.type==='BROWSER_ORDER_FAILED'&&order&&!hasMoney){
    if(order[2].startsWith('没走到付款就停了（')&&order[2].includes('CDK 已自动退回、卡已释放'))
      return withOrder('充值未完成','未付款；CDK已退回，客户可重新兑换。');
    if(order[2].startsWith('原因 ')&&order[2].endsWith('账号仍为免费，未扣款，卡片已释放。'))
      return withOrder('付款被拒绝','未扣款，卡片已释放。请到后台查看原因。');
  }
  if(delivery.type==='DAILY_RECONCILIATION_SUMMARY')return {...base,message:message
    .replace(/：卡台扣了、账本没记、也没登记手动用卡，进报告待核。/g,'，待核实。')
    .replace(/已登记手动用卡的 (\d+) 张：卡台扣了、你已登记，账本待补记。/g,'手动用卡待补记 $1 张。')
    .replace(/。(?=\S)/g,'。\n')};
  return order?withOrder(title,order[2]):email?withOrder(title,message):base;
}
