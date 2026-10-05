const test = require('node:test');
const assert = require('node:assert/strict');
const State = require('../src/homekit/StateAccessory');
const Garage = require('../src/homekit/accessories/HttpWebHookGarageDoorOpenerAccessory');
const Lock = require('../src/homekit/accessories/HttpWebHookLockMechanismAccessory');
const Command = require('../src/CommandRequest');
const {fixture} = require('./fixture.cjs');
function clock(t) {
  let now = 0; const tasks = new Map();
  t.mock.method(State.prototype, 'now', () => now);
  t.mock.method(global, 'setTimeout', (fn, ms) => {const handle = {unref(){}}; tasks.set(handle, {fn, at:now+ms}); return handle;});
  t.mock.method(global, 'clearTimeout', handle => tasks.delete(handle));
  return {tasks, advance(ms) {now += ms; for (const [h, task] of [...tasks]) if(task.at<=now){tasks.delete(h);task.fn();}}};
}
function read(a, field) { let output; a.get(field,(error,value)=>{output={error,value};}); return output; }
for (const Kind of [Garage, Lock]) {
  test(Kind.name + ': only valid current reports renew freshness, legacy and v1 recover', t => {
    const time=clock(t); const a=fixture(t,Kind,{state_mode:'external',feedback_timeout_seconds:5});
    t.after(()=>a.close());
    assert.equal(a.status().availability.currentState,'awaiting_feedback');
    a.apply({currentState:0}); const stamp=a.status().observedAt.currentState;
    time.advance(4000); a.apply({targetState:1}); a.status(); read(a,'currentState');
    let commands=0;t.mock.method(Command,'send',(_,cb)=>{commands++;cb(null);});a.command(1,assert.ifError);
    assert.throws(()=>a.apply({currentState:0,targetState:99}));
    assert.equal(a.status().observedAt.currentState,stamp);
    time.advance(1000);assert.equal(a.status().availability.currentState,'stale');
    assert.ok(read(a,'currentState').error);assert.ok(a.characteristics.currentState.value instanceof Error);
    assert.equal(a.values.currentState,0);assert.equal(commands,1);
    const key=Kind===Garage?'currentdoorstate':'lockcurrentstate';
    a.changeFromServer({[key]:'0'});assert.equal(read(a,'currentState').value,0);
    assert.equal(a.status().availability.currentState,'observed');assert.equal(commands,1);
    time.advance(4000);a.apply({currentState:0});time.advance(4000);
    assert.equal(read(a,'currentState').value,0);time.advance(1000);assert.ok(read(a,'currentState').error);
  });
  test(Kind.name + ': optimistic completion neither renews nor recovers expired observations', t => {
    const time=clock(t);const a=fixture(t,Kind,{feedback_timeout_seconds:5});t.after(()=>a.close());
    assert.equal(a.status().availability.currentState,'default');
    time.advance(4000);a.command(0,assert.ifError);time.advance(1000);
    assert.equal(a.status().availability.currentState,'stale');a.command(1,assert.ifError);
    assert.ok(read(a,'currentState').error);assert.equal(a.status().observedAt.currentState,null);
    a.apply({currentState:1});assert.equal(read(a,'currentState').value,1);
  });
}
test('obstruction monitoring awaits its own report even with use_cache; independent expiry and false recovery', t => {
  const time=clock(t);const a=fixture(t,Garage,{startup_state_policy:'use_cache',feedback_timeout_seconds:5,obstruction_monitoring:true,obstruction_timeout_seconds:3});t.after(()=>a.close());
  assert.ok(read(a,'obstruction').error);a.apply({currentState:1,obstruction:true});
  time.advance(2000);a.apply({currentState:1});time.advance(1000);
  assert.equal(a.status().availability.obstruction,'stale');assert.equal(read(a,'currentState').value,1);
  a.apply({obstruction:false});assert.equal(read(a,'obstruction').value,false);
  time.advance(4000);assert.equal(a.status().availability.currentState,'stale');
});
test('restart never trusts saved observation timestamps; cache grace is explicitly unverified', t => {
  const time=clock(t);const a=fixture(t,Garage,{state_mode:'external',feedback_timeout_seconds:5});a.apply({currentState:0});a.close();
  const b=fixture(t,Garage,{state_mode:'external',feedback_timeout_seconds:5},{},a.platform.cacheDirectory);t.after(()=>b.close());
  assert.equal(b.status().availability.currentState,'awaiting_feedback');
  const c=fixture(t,Garage,{state_mode:'external',startup_state_policy:'use_cache',feedback_timeout_seconds:5},{},a.platform.cacheDirectory);t.after(()=>c.close());
  assert.equal(c.status().availability.currentState,'unverified_cache');time.advance(5000);assert.ok(read(c,'currentState').error);
});
test('default behavior has no timers; shutdown cancels all timers and rejects late reports', t => {
  const time=clock(t);const a=fixture(t);a.apply({currentState:0});assert.equal(time.tasks.size,0);
  const b=fixture(t,Garage,{feedback_timeout_seconds:5,obstruction_monitoring:true,obstruction_timeout_seconds:3});b.apply({currentState:0,obstruction:false});
  assert.equal(time.tasks.size,2);b.close();assert.equal(time.tasks.size,0);time.advance(10000);
  assert.throws(()=>b.apply({currentState:1}),/accessory_closed/);
});
test('freshness settings reject invalid and lock-only obstruction combinations', t => {
  for(const value of [-1,Infinity,NaN,'5',null,604801]) assert.throws(()=>fixture(t,Garage,{feedback_timeout_seconds:value}));
  assert.throws(()=>fixture(t,Garage,{obstruction_timeout_seconds:5}),/requires_monitoring/);
  assert.throws(()=>fixture(t,Garage,{obstruction_monitoring:'true'}),/invalid_config/);
  assert.throws(()=>fixture(t,Lock,{obstruction_monitoring:false}),/invalid_config/);
});
