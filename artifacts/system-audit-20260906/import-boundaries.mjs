import assert from 'node:assert/strict';
import {zipSync,strToU8} from '../../v1/node_modules/fflate/esm/index.mjs';
import {parseManualCardWorkbook} from '../../v1/src/services/manual-card-import-service.js';
const headers=['卡序列号','累计充值','累计消费','余额','卡号','CVC','有效期','开卡状态','开卡时间','FirstName','LastName','州','城市','街道','邮编','标签','分组名称'];
const row=(id,expiry='12/39')=>[id,'20','0','20','4111111111111111','123',expiry,'已激活','fixture','Test','Only','DE','Wilmington','Fixture St','19801','',''];
function workbook(data){const rows=[['fixture'],headers,...data];let cursor=0;
 const shared='<sst>'+rows.flat().map(v=>`<si><t>${v}</t></si>`).join('')+'</sst>';
 const sheet='<worksheet><sheetData>'+rows.map((r,ri)=>`<row r="${ri+1}">`+r.map((_,ci)=>`<c r="${String.fromCharCode(65+ci)}${ri+1}" t="s"><v>${cursor++}</v></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>';
 return Buffer.from(zipSync({'xl/sharedStrings.xml':strToU8(shared),'xl/worksheets/sheet1.xml':strToU8(sheet)}));}
const now=new Date();const exp=`${String(now.getUTCMonth()+1).padStart(2,'0')}/${String(now.getUTCFullYear()).slice(-2)}`;
const month=parseManualCardWorkbook(workbook([row('same-month',exp)]));
assert(month[0].availabilityReasons.includes('EXPIRED_CARD'));
const duplicate=parseManualCardWorkbook(workbook([row('seq-a'),row('seq-b')]));assert(duplicate.every(x=>x.structuralErrors.length===0));
const empty=parseManualCardWorkbook(workbook([]));assert.equal(empty.length,0);
const blank=row('blank-money');blank[1]='';blank[2]='';blank[3]='';const blankParsed=parseManualCardWorkbook(workbook([blank]));assert.equal(blankParsed[0].balance,0);assert(!blankParsed[0].structuralErrors.includes('INVALID_BALANCE'));
console.log(JSON.stringify({mode:'SYNTHETIC_WORKBOOK_NO_SECRETS',currentMonthExpiry:{expiry:exp,classification:month[0].availabilityReasons},samePanDifferentSequence:{rows:duplicate.length,structuralErrorCounts:duplicate.map(x=>x.structuralErrors.length)},headersOnly:{acceptedRows:empty.length},blankMoney:{balance:blankParsed[0].balance,structuralErrors:blankParsed[0].structuralErrors},limits:'Parser behavior only. Duplicate PAN database commit/allocation and zero-row snapshot mutations not executed.'},null,2));
