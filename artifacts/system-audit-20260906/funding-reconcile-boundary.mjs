import assert from 'node:assert/strict';
import {createCardFundingRepository} from '../../v1/src/db/repositories/card-funding-repository.js';
const queries=[];
const pool={async query(sql,args){queries.push({sql,args});if(sql.includes('SELECT setting_value'))return [[{setting_value:'18'}]];if(sql.includes('UPDATE card_funding_attempts'))return [{affectedRows:1}];throw Error('Unexpected query');}};
const result=await createCardFundingRepository(pool).reconcile({attemptId:'fixture-pending-topup',currentBalance:18,currency:'USD'});
assert.equal(result.state,'SETTLED');assert(!queries.some(x=>x.sql.includes('SELECT')&&x.sql.includes('card_funding_attempts')));
console.log(JSON.stringify({mode:'ACTUAL_REPOSITORY_FAKE_DB',result,readsOnlyGlobalMinimum:true,note:'No read of requested top-up amount, pre-top-up balance, or provider transaction in this function; no claim that a production top-up was misclassified.'},null,2));
