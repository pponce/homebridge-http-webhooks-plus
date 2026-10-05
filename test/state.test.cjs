const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const Garage = require('../src/homekit/accessories/HttpWebHookGarageDoorOpenerAccessory');
const Lock = require('../src/homekit/accessories/HttpWebHookLockMechanismAccessory');
const transport = require('../src/CommandRequest');
const {bodyObject} = require('../src/StateContract');
const {fixture}=require('./fixture.cjs');
function get(a, field) { let result; a.get(field,(err,value)=>{if(err)throw err;result=value;});return result; }
for (const Kind of [Garage, Lock]) {
  test(Kind.name + ': zero states agree across applied response, characteristic, getter and restart', t => {
    const a = fixture(t, Kind), fields = {currentState:'0',targetState:0};
    if (Kind === Garage) fields.obstruction = 'false';
    const r = a.apply(fields); assert.equal(r.state.currentState,0);assert.equal(r.previous.currentState,1);
    for(const key of Object.keys(fields))assert.equal(a.characteristics[key].value,get(a,key));
    const b = fixture(t,Kind,{}, {}, a.platform.cacheDirectory);assert.equal(get(b,'currentState'),0);
    assert.equal(b.status().availability.currentState,'unverified_cache');
  });
  test(Kind.name + ': external command cannot invent completion; report does not command', t => {
    const a = fixture(t,Kind,{state_mode:'external'});
    assert.throws(()=>get(a,'currentState'),/unavailable/);
    const before = a.status().observedAt.currentState;
    let calls=0;t.mock.method(transport,'send',(_,cb)=>{calls++;cb(null);});
    a.command(0,err=>assert.equal(err,null));
    assert.equal(calls,1);assert.throws(()=>get(a,'currentState'),/unavailable/);
    assert.equal(a.status().observedAt.currentState,before);
    a.apply({currentState:0,targetState:1});assert.equal(calls,1);assert.equal(get(a,'targetState'),1);
  });
  test(Kind.name + ': optimistic success persists coherent current state', t => {
    const a=fixture(t,Kind);a.command(0,err=>assert.equal(err,null));
    assert.equal(get(a,'currentState'),0);assert.equal(a.characteristics.currentState.value,0);
    assert.equal(fixture(t,Kind,{}, {},a.platform.cacheDirectory).values.currentState,0);
  });
  test(Kind.name + ': late and overlapping responses preserve newer state and targets', t => {
    const a=fixture(t,Kind), pending=[];t.mock.method(transport,'send',(_,cb)=>pending.push(cb));
    let first,second;
    a.command(0,e=>first=e);a.command(1,e=>second=e);
    pending[1](null);pending[0](null);assert.equal(first.code,'command_superseded');assert.equal(second,null);assert.equal(get(a,'currentState'),1);
    a.command(0,e=>first=e);a.apply({currentState:Kind===Garage?2:2,targetState:0});pending[2](null);
    assert.equal(first,null);assert.equal(get(a,'currentState'),2);
  });
  test(Kind.name + ': invalid multi-field input is fully rejected', t => {
    const a=fixture(t,Kind);const before=a.status();
    for(const bad of [null,'',false,NaN,Infinity,[],{},'00',' 0','1.0',-1,99]){
      assert.throws(()=>a.apply({currentState:0,targetState:bad}));assert.deepEqual(a.status(),before);
    }
    assert.throws(()=>a.apply({currentState:0,notify:[]}));assert.deepEqual(a.status(),before);
  });
  test(Kind.name + ': persistence failure fails closed without a success or mixed snapshot', t => {
    const a=fixture(t,Kind);t.mock.method(a.store,'write',()=>{throw Error('SECRET');});
    assert.throws(()=>a.apply({currentState:0,targetState:0}),/state_storage_unavailable/);
    assert.throws(()=>get(a,'currentState'),/unavailable/);assert.equal(a.values.currentState,1);
    assert.equal(a.status().success,false);assert.equal(a.status().availability.targetState,'storage_error');
    assert.throws(()=>a.apply({currentState:1}),/state_storage_unavailable/);
  });
  test(Kind.name + ': explicit notifications are opt-in and do not throttle changes', t => {
    const a=fixture(t,Kind,{notification_policy:'allow_explicit',notification_min_interval_ms:60000});
    const events=[];for(const [f,c] of Object.entries(a.characteristics))c.on('event',v=>events.push([f,v]));
    let r=a.apply({currentState:0,targetState:0,notify:true});assert.equal(r.notification.outcome,'sent');
    r=a.apply({currentState:0,targetState:0,notify:true});assert.equal(r.notification.outcome,'rate_limited');assert.equal(events.length,2);
    r=a.apply({currentState:1,targetState:1,notify:true});assert.equal(r.notification.outcome,'sent');assert.equal(events.length,4);
    const b=fixture(t,Kind);assert.equal(b.apply({currentState:0,notify:true}).notification.outcome,'disabled');
  });
  test(Kind.name + ': authenticated-status payload reads never renew feedback or emit', t => {
    const a=fixture(t,Kind);a.apply({currentState:0});const before=a.status();
    for(let i=0;i<3;i++)assert.deepEqual(a.status(),before);
  });
}
test('garage obstruction set AND clear survive mixed throttled explicit requests', t => {
 const a=fixture(t,Garage,{notification_policy:'allow_explicit'});
 a.apply({currentState:0,targetState:0,obstruction:true,notify:true});
 const result=a.apply({currentState:0,targetState:0,obstruction:false,notify:true});
 assert.equal(result.state.obstruction,false);assert.equal(result.notification.outcome,'partial');
 assert.equal(result.notification.fields.obstruction,'sent');assert.equal(get(a,'obstruction'),false);
});
test('legacy fields return previous typed values by default and applied mode is explicit',t=>{
 const a=fixture(t);assert.deepEqual(a.changeFromServer({currentdoorstate:'0',obstructiondetected:'true'}),{success:true,currentState:1,obstruction:false});
 a.responseMode='applied';assert.equal(a.changeFromServer({targetdoorstate:'0'}).state.targetState,0);
});
test('legacy cache keys import without deletion and explicit external cache remains unverified',t=>{
 const legacy={'http-webhook-current-door-state-sample':'0'};
 const a=fixture(t,Garage,{external_state:true,startup_state_policy:'use_cache'},legacy);
 assert.equal(get(a,'currentState'),0);assert.equal(a.status().availability.currentState,'unverified_cache');
 assert.deepEqual(legacy,{'http-webhook-current-door-state-sample':'0'});
 assert.throws(()=>fixture(t,Garage,{external_state:true,state_mode:'optimistic'}),/conflicting/);
 assert.throws(()=>fixture(t,Lock,{external_state:true}),/invalid_config/);
});
test('flat JSON parser rejects duplicate escaped keys, arrays, trailing data and commas',()=>{
 assert.deepEqual({...bodyObject('{"currentState":0,"notify":false}')},{currentState:0,notify:false});
 for(const bad of ['{"currentState":0,"currentState":1}','{"currentState":0,"current\\u0053tate":1}','{"x":[]}','{"x":{}}','{"x":0,}','{}{}','{"x":01}','{"x":NaN}'])assert.throws(()=>bodyObject(bad),bad);
});
