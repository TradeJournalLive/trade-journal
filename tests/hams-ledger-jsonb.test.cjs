const {test}=require('node:test'),assert=require('node:assert/strict');
const {matchesHamsLedgerRecord,digest}=require('../scripts/hams-journal.cjs');
test('ledger acknowledges identical JSONB records despite key ordering',()=>{
 const original={id:'a',type:'TRADE',value:{entry:100,exit:110,pnl:650},at:'2026-11-05T03:00:00Z'};
 const readback={at:original.at,value:{pnl:650,exit:110,entry:100},type:'TRADE',id:'a'};
 assert.notEqual(digest(original),digest(readback));
 assert.equal(matchesHamsLedgerRecord({recordHash:digest(original),record:original},readback),true);
});
test('matching hash alone cannot hide changed or missing immutable data',()=>{
 const record={id:'a',value:{entry:100,pnl:650}};
 assert.equal(matchesHamsLedgerRecord({recordHash:digest(record),record:{...record,value:{entry:100,pnl:700}}},record),false);
 assert.equal(matchesHamsLedgerRecord({recordHash:digest(record)},record),false);
 assert.equal(matchesHamsLedgerRecord({record},record),false);
});
