// Offline evidence formatter only; never connects to DB or changes business data.
import {readFileSync} from 'node:fs';
const rows=file=>readFileSync(new URL(file,import.meta.url),'utf8').trim().split('\n').map(line=>{
  const i=line.indexOf('\t'),kind=line.slice(0,i),raw=line.slice(i+1);
  return {kind,data:kind==='observed_at'?raw:JSON.parse(raw)};
});
const raw=rows('raw.tsv'),detail=rows('detail.tsv');
const orders=raw.filter(r=>r.kind==='order').map(r=>r.data);
const rehearsals=new Set(detail.filter(r=>r.kind==='rehearsal_marker').map(r=>r.data.order));
const noCharge=new Set(detail.filter(r=>r.kind==='manual_resolution'&&r.data.verifiedOutcome==='NOT_CHARGED'&&r.data.hasNote).map(r=>r.data.order));
if(orders.length!==78)throw Error('Evidence changed: review counts before generating this dated preview');
console.log('# 78条订单逐项分类预览\n\n只读建议，未执行清理。标签可重叠；“无本轮异常标记”不代表已逐笔核对外部卡台或客户权益。原始字段见raw.tsv/detail.tsv，生成器只处理脱敏查询输出。\n');
console.log('| 订单 | 状态 | 创建日（UTC） | 分类依据/建议 |\n|---|---|---|---|');
const counts={};
for(const o of orders){
 const tags=[];
 if(rehearsals.has(o.publicNo))tags.push('有审计标记的演练：保留记录，可单独筛选/排除运营统计');
 if(o.heldLedger)tags.push('账本待对账：不关不释放');
 if(o.cancellationReview)tags.push('取消续费待核实：保留');
 if(o.status==='RECHARGE_SUCCESS'&&!o.consumed)tags.push('成功单缺消费账本：不能猜金额补账');
 if(o.status!=='RECHARGE_SUCCESS'&&o.cdkStatus==='REDEEMED'&&o.cdkPointsHere&&!rehearsals.has(o.publicNo))tags.push('旧CDK仍绑定：先确认测试死码或客户权益');
 if(o.openCases&&noCharge.has(o.publicNo)&&!o.activeFunds&&!o.heldLedger&&!o.activeAssignments)tags.push('有未扣款收口审计：仅建议关闭遗留案例');
 if(!tags.length)tags.push('保留历史；无本轮上述标记，不作物理删除');
 for(const t of tags)counts[t]=(counts[t]||0)+1;
 console.log(`| ${o.publicNo} | ${o.status} | ${o.created.slice(0,10)} | ${tags.join('；')} |`);
}
console.log('\n## 标签计数（不可相加）\n');for(const [tag,n]of Object.entries(counts))console.log(`- ${tag}：${n}`);
console.log('\n## 付款不明告警候选清单\n\n这些不是执行授权。4条人工未扣款终态、6条已付款成功/续费关闭终态；执行前重新校验关联证据，保留原告警历史。\n');
console.log('| 告警ID | 关联订单 | 当前订单状态 |\n|---|---|---|');
for(const {data:a}of raw.filter(r=>r.kind==='alert'&&r.data.type==='BROWSER_PAYMENT_UNKNOWN')){
 const o=orders.find(o=>o.publicNo===a.order);console.log(`| ${a.id} | ${a.order} | ${o?.status||'未找到'} |`);
}
