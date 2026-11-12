const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child;
let base;
let tempDir;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}
async function waitForServer() {
  for (let i=0;i<60;i++) { try { await fetch(`${base}/api/me`); return; } catch { await new Promise(r=>setTimeout(r,100)); } }
  throw new Error('Test server did not start.');
}
function client() {
  let cookie='';
  return {
    async request(route,method='GET',body) {
      const headers={}; if(cookie)headers.Cookie=cookie; if(body)headers['Content-Type']='application/json';
      const response=await fetch(`${base}${route}`,{method,headers,body:body?JSON.stringify(body):undefined});
      const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
      return {status:response.status,data:await response.json()};
    }
  };
}

test.before(async()=>{
  tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'fitpath-test-'));
  const port=await freePort();base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(port),DATA_DIR:tempDir},stdio:['ignore','ignore','pipe']});
  await waitForServer();
});
test.after(async()=>{
  if(child){child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));}
  if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});
});

test('user data is isolated and logged totals are calculated from records',async()=>{
  const alice=client(),bob=client();
  assert.equal((await alice.request('/api/activities','POST',{type:'Walk',date:'2026-10-23',duration:40})).status,401);
  const registered=await alice.request('/api/register','POST',{name:'Alice Example',email:'alice@example.test',password:'correct-horse-battery-staple',confirm_password:'correct-horse-battery-staple',gender:'Prefer not to say'});
  assert.equal(registered.status,201);
  const second=await bob.request('/api/register','POST',{name:'Bob Example',email:'bob@example.test',password:'another-long-password-2026',confirm_password:'another-long-password-2026',gender:'Prefer not to say'});
  assert.equal(second.status,201);
  assert.equal((await alice.request('/api/login','POST',{email:'alice@example.test',password:'correct-horse-battery-staple'})).status,200);
  assert.equal((await bob.request('/api/login','POST',{email:'bob@example.test',password:'another-long-password-2026'})).status,200);
  const catalog=await alice.request('/api/catalog');assert.ok(catalog.data.foods.length>=10);assert.ok(catalog.data.exercises.length>=10);
  assert.equal((await alice.request('/api/activities','POST',{type:'Walking',date:'2026-10-23',duration:35,distance:2.4,steps:4200,intensity:'Moderate',calories:150})).status,201);
  const food=catalog.data.foods.find(x=>x.name==='Banana');
  assert.equal((await alice.request('/api/food-logs','POST',{food_id:food.id,meal:'Snack',servings:2,date:'2026-10-23'})).status,201);
  assert.equal((await alice.request('/api/body-metrics','POST',{weight_kg:63.2,date:'2026-10-23'})).status,201);
  const summary=await alice.request('/api/summary?date=2026-10-23');
  assert.equal(summary.data.activity.minutes,35);assert.equal(summary.data.activity.steps,4200);assert.equal(summary.data.nutrition.calories,210);
  const records=await alice.request('/api/logs?date=2026-10-23');const activityId=records.data.activities[0].id;
  assert.equal((await bob.request(`/api/edit/activity/${activityId}`,'PATCH',{type:'Running',date:'2026-10-23',duration:99})).status,404);
  assert.equal((await alice.request(`/api/edit/activity/${activityId}`,'PATCH',{type:'Walking',date:'2026-10-23',duration:45,distance:3,steps:5000,intensity:'Hard',calories:180,notes:'Updated'})).status,200);
  assert.equal((await alice.request('/api/summary?date=2026-10-23')).data.activity.steps,5000);
  const bobLogs=await bob.request('/api/logs?date=2026-10-23');assert.equal(bobLogs.data.activities.length,0);assert.equal(bobLogs.data.meals.length,0);assert.equal(bobLogs.data.body.length,0);
});

test('workout sets persist, invalid input is rejected, and owner-scoped deletion works',async()=>{
  const user=client();const me=await user.request('/api/login','POST',{email:'alice@example.test',password:'correct-horse-battery-staple',confirm_password:'correct-horse-battery-staple',gender:'Prefer not to say'});assert.equal(me.status,200);
  const catalog=await user.request('/api/catalog');const squat=catalog.data.exercises.find(x=>x.name==='Goblet squat');
  assert.equal((await user.request('/api/workouts','POST',{title:'Leg day',date:'2026-10-23',duration:42,sets:[{exercise_id:squat.id,reps:10,weight_kg:12}]})).status,201);
  const logs=await user.request('/api/logs?date=2026-10-23');assert.equal(logs.data.workouts[0].title,'Leg day');assert.equal(logs.data.workouts[0].set_count,1);
  assert.equal((await user.request('/api/activities','POST',{type:'Walk',date:'not-a-date',duration:0})).status,400);
  const deleted=await user.request(`/api/workouts/${logs.data.workouts[0].id}`,'DELETE');assert.equal(deleted.status,200);
  assert.equal((await user.request('/api/logs?date=2026-10-23')).data.workouts.length,0);
});
