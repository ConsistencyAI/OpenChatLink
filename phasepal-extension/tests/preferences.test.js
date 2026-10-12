import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences, snapshotKey} from '../preferences.js';

test('preferences default to no selected chats and reject invalid modes, dates, or IDs',()=>{
  assert.deepEqual(normalizePreferences(),{chats:'selected',selected:[],history:'all',sinceDate:'',schedule:'auto'});
  for(const invalid of [{chats:'unknown'},{schedule:'often'},{history:'since',sinceDate:'2026-02-30'},
    {history:'since',sinceDate:''},{selected:[{accountId:'personal',id:'../../other'}]}])assert.throws(()=>normalizePreferences(invalid));
});

test('selection keys are account-scoped and independent of selection order',()=>{
  const a={accountId:'account-a',id:'ABCDEFAB-0000-4000-8000-000000000001',title:'Reina'};
  const b={accountId:'account-b',id:a.id};
  const value=normalizePreferences({selected:[a,b,a]});
  assert.equal(value.selected.length,2);
  assert.equal(value.selected[0].id,a.id.toLowerCase());
  assert.equal(snapshotKey(value),snapshotKey({selected:[b,a]}));
  assert.equal(snapshotKey(value),snapshotKey({selected:[b,{...a,title:'Renamed chat'}]}));
});
