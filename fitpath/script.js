const $ = (selector, root = document) => root.querySelector(selector);
function installInputRules() {
  const ignoredForms = '#login-form, #confirm-form';
  const textSelector = 'input:not([type]), input[type="text"], input[type="search"], textarea';
  const editable = field => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
  const excluded = field => {
    const auth = field.closest('#auth-form');
    if (auth) {
      const signingUp = !$('#name-wrap').classList.contains('hidden');
      return !(signingUp && (field.name === 'name' || field.id === 'signup-height' || field.id === 'signup-weight'));
    }
    return !!field.closest(ignoredForms);
  };
  const kind = field => field.closest('#auth-form') && field.name === 'name' ? 'name' : field.type === 'number' ? 'number' : 'text';
  const cleanNumber = value => {
    const cleaned = String(value).replace(/[^0-9.]/g, '');
    const dot = cleaned.indexOf('.');
    return dot < 0 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  };
  const cleanText = value => String(value).replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '');
  const cleanName = value => String(value).replace(/\s+/g, ' ').replace(/[^\p{L} ]/gu, '');
  const allowed = (field, value) => kind(field) === 'number'
    ? /^\d*\.?\d*$/.test(value)
    : kind(field) === 'name' ? /^[\p{L} ]*$/u.test(value)
    : /^[\p{L}\p{N} ]*$/u.test(value);
  function prepare(field) {
    let wrap = field.parentElement?.classList.contains('input-guard-wrap') ? field.parentElement : null;
    if (!wrap) {
      wrap = document.createElement('span');
      wrap.className = 'input-guard-wrap';
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
    }
    let note = wrap.querySelector('.input-guard-note');
    if (!note) {
      note = document.createElement('span');
      note.className = 'input-guard-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.hidden = true;
      wrap.appendChild(note);
    }
    return note;
  }
  function notify(field) {
    const note = prepare(field);
    note.textContent = kind(field) === 'number'
      ? 'Only numbers are allowed.'
      : kind(field) === 'name' ? 'Only letters and spaces are allowed.'
      : 'Only letters, numbers, and spaces are allowed.';
    note.hidden = false;
  }
  function clear(field) {
    const wrap = field.parentElement?.classList.contains('input-guard-wrap') ? field.parentElement : null;
    const note = wrap?.querySelector('.input-guard-note');
    if (note) note.hidden = true;
  }
  function matches(field) {
    return editable(field) && (field.matches(textSelector) || field.type === 'number') && !excluded(field);
  }

  document.addEventListener('beforeinput', event => {
    const field = event.target;
    if (!matches(field) || event.inputType?.startsWith('delete')) return;
    if (event.data === null) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const candidate = field.value.slice(0, start) + event.data + field.value.slice(end);
    if (!allowed(field, candidate)) {
      event.preventDefault();
      notify(field);
    } else clear(field);
  });

  document.addEventListener('keydown', event => {
    const field = event.target;
    if (!matches(field) || field.type !== 'number' || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const candidate = field.value.slice(0, start) + event.key + field.value.slice(end);
    if (!allowed(field, candidate)) {
      event.preventDefault();
      notify(field);
    }
  });

  document.addEventListener('paste', event => {
    const field = event.target;
    if (!matches(field)) return;
    const pasted = event.clipboardData?.getData('text') ?? '';
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const candidate = field.value.slice(0, start) + pasted + field.value.slice(end);
    if (!allowed(field, candidate)) {
      event.preventDefault();
      notify(field);
    } else clear(field);
  });

  document.addEventListener('input', event => {
    const field = event.target;
    if (!matches(field)) return;
    const cleaned = kind(field) === 'number' ? cleanNumber(field.value) : kind(field) === 'name' ? cleanName(field.value) : cleanText(field.value);
    if (cleaned !== field.value) {
      const before = field.type === 'number' ? '' : field.value.slice(0, field.selectionStart ?? field.value.length);
      field.value = cleaned;
      if (field.type !== 'number') {
        const position = (kind(field) === 'name' ? cleanName(before) : cleanText(before)).length;
        field.setSelectionRange(position, position);
      }
      notify(field);
    } else clear(field);
  });
}
installInputRules();

const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $('#app');
const authScreen = $('#auth-screen');
const dialog = $('#entry-dialog');
const dialogContent = $('#dialog-content');
const settingsDialog = $('#settings-dialog');
const state = { user: null, summary: null, logs: null, catalog: { foods: [], exercises: [] }, authMode: 'login', page: 'dashboard', chartMode: 'minutes', authNotice: '', pendingEmail: '' };
function isValidEmailAddress(value) {
  const email=String(value??'');
  if(email.length>254)return false;
  const at=email.lastIndexOf('@');
  if(at<1||at!==email.indexOf('@'))return false;
  const local=email.slice(0,at),domain=email.slice(at+1);
  if(local.length>64||! /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u.test(local))return false;
  if(domain.length>253)return false;
  const labels=domain.split('.');
  const labelPattern=/^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
  return labels.length>=2&&labels.every(label=>label.length<=63&&labelPattern.test(label))&&labels.at(-1).length>=2&&/[\p{L}]/u.test(labels.at(-1));
}
const nowLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,10); };
const today = nowLocal();
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits = 0) => new Intl.NumberFormat(undefined,{maximumFractionDigits:digits}).format(Number(value)||0);
const dateLabel = (value) => { if (!value) return ''; const date = new Date(`${value.slice(0,10)}T12:00:00`); return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(date); };
const timeLabel = (value) => value ? new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(value)) : '';
let toastTimer;
function toast(message) { const node=$('#toast'); node.textContent=message;node.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('visible'),3200); }
async function api(url, options = {}) {
  const response = await fetch(url,{...options,credentials:'same-origin',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const sidebar=$('#sidebar'),menuToggle=$('#menu-toggle'),menuBackdrop=$('#sidebar-backdrop');
function setMenuOpen(open){sidebar.classList.toggle('menu-open',open);menuBackdrop.classList.toggle('hidden',!open);menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');document.body.classList.toggle('menu-open',open);}
menuToggle.addEventListener('click',()=>setMenuOpen(menuToggle.getAttribute('aria-expanded')!=='true'));
menuBackdrop.addEventListener('click',()=>setMenuOpen(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape')setMenuOpen(false);});
function showAuth() { app.classList.add('hidden'); authScreen.classList.remove('hidden'); updateAuthMode(); }
function showApp() { authScreen.classList.add('hidden'); app.classList.remove('hidden'); renderProfile(); navigate(state.page); refresh(); }
function updateAuthMode() {
  const register=state.authMode==='register';$('#auth-title').textContent=register?'Start with one small step.':'Make space for better.';$('#auth-subtitle').textContent=register?'Create your private Fitpath account.':'Sign in to keep your progress moving.';$('#auth-submit').innerHTML=register?'Create account <span>&rarr;</span>':'Sign in <span>&rarr;</span>';
$('#name-wrap').classList.toggle('hidden',!register);$('#confirm-password-wrap').classList.toggle('hidden',!register);$('#gender-wrap').classList.toggle('hidden',!register);$('#signup-measurements').classList.toggle('hidden',!register);
$('#name-wrap input').required=register;$('#confirm-password-wrap input').required=register;$('#gender-wrap select').required=register;$('#signup-height').required=register;$('#signup-weight').required=register;$('#auth-form [name=password]').autocomplete=register?'new-password':'current-password';
  const email=$('#auth-form [name=email]');if(!register&&state.pendingEmail)email.value=state.pendingEmail;email.setCustomValidity(register&&email.value.trim()&&!isValidEmailAddress(email.value.trim())?'Enter a valid email address, such as name@example.com.':'');$('#auth-notice').textContent=state.authNotice;$('#auth-notice').classList.toggle('hidden',!state.authNotice);
  $('#auth-switch').innerHTML=register?'Already have an account? <button type="button">Sign in</button>':'New to Fitpath? <button type="button">Create an account</button>';$('#auth-switch button').onclick=()=>{state.authMode=register?'login':'register';state.authNotice='';$('#auth-error').textContent='';updateAuthMode();};
}
$('#auth-form [name=email]').addEventListener('input',event=>{const input=event.currentTarget;if(state.authMode==='register'){input.value=input.value.trim();input.setCustomValidity(input.value&&!isValidEmailAddress(input.value)?'Enter a valid email address, such as name@example.com.':'');}else input.setCustomValidity('');});
$('#auth-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,register=state.authMode==='register',body=Object.fromEntries(new FormData(form));$('#auth-error').textContent='';try{if(register){body.name=String(body.name||'').trim();body.email=String(body.email||'').trim();if(!/^[\p{L}]+(?: +[\p{L}]+)*$/u.test(body.name))throw new Error('Your name can contain letters and spaces only.');if(body.password!==body.confirm_password)throw new Error('Passwords do not match.');if(!body.height_cm||!body.weight_kg)throw new Error('Enter both height and weight to calculate BMI.');}const result=await api(register?'/api/register':'/api/login',{method:'POST',body:JSON.stringify(body)});if(register){state.pendingEmail=body.email;state.authMode='login';state.authNotice='Account created. Sign in below to get started.';form.reset();updateAuthMode();$('#auth-form [name=email]').value=state.pendingEmail;$('#auth-form [name=password]').focus();return;}state.user=result.user;state.pendingEmail='';state.authNotice='';form.reset();state.page='dashboard';showApp();}catch(error){$('#auth-error').textContent=error.message;}});
$('#signout').addEventListener('click',async()=>{setMenuOpen(false);const choice=await window.fitpathConfirm({title:'Sign out?',message:'Are you sure you want to log out?',confirmText:'Sign out'});if(!choice.confirmed)return;try{await api('/api/logout',{method:'POST'});}catch{}state.user=null;state.logs=null;state.authMode='login';showAuth();});

function renderProfile(){if(!state.user)return;$('#profile-name').textContent=state.user.name;$('#avatar-letter').textContent=state.user.name.trim().slice(0,1).toUpperCase();$('#today-label').textContent=new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(new Date());const hour=new Date().getHours();$('#greeting').textContent=`Good ${hour<12?'morning':hour<18?'afternoon':'evening'}, ${state.user.name.split(' ')[0]}.`;$('#move-goal').textContent='of 30 min goal';$('#calorie-goal').textContent=`of ${fmt(state.user.calories_goal)} kcal`;}
function navigate(page){if(!document.querySelector(`#page-${page}`))page='dashboard';state.page=page;$$('.page').forEach(el=>el.classList.toggle('active',el.id===`page-${page}`));$$('.nav-link').forEach(el=>el.classList.toggle('active',el.dataset.page===page));const labels={dashboard:'OVERVIEW',activity:'ACTIVITY',workouts:'WORKOUTS',nutrition:'NUTRITION',progress:'PROGRESS',wellness:'SLEEP & WELLNESS'};$('#page-label').textContent=labels[page];history.replaceState(null,'',`#${page}`);}
document.addEventListener('click',event=>{const nav=event.target.closest('[data-page]');if(nav){navigate(nav.dataset.page);setMenuOpen(false);return;}const edit=event.target.closest('[data-edit]');if(edit){const type=edit.dataset.edit,collection=type==='activity'?'activities':type==='food'?'meals':type==='body'?'body':type==='sleep'?'sleep':type==='goal'?'goals':'workouts';const record=state.logs?.[collection]?.find(item=>item.id===Number(edit.dataset.id));if(record)openForm(type,record);return;}const open=event.target.closest('[data-open-form]');if(open){openForm(open.dataset.openForm);return;}});
async function refresh(){if(!state.user)return;try{const [summary,logs,catalog]=await Promise.all([api(`/api/summary?date=${today}`),api(`/api/logs?date=${today}`),api('/api/catalog')]);state.summary=summary;state.logs=logs;state.catalog=catalog;renderAll();}catch(error){toast(error.message);if(error.message.includes('sign in'))showAuth();}}
function renderAll(){renderProfile();renderDashboard();renderActivities();renderWorkouts();renderNutrition();renderProgress();renderWellness();}
const pct=(value,goal)=>goal?Math.min(100,Math.round(value/goal*100)):0;
function empty(message,detail='Your entries will appear here when you log them.') {return `<div class="empty-state"><strong>${esc(message)}</strong>${esc(detail)}</div>`;}
function itemDelete(type,id,label='record'){return `<button class="delete-button" data-delete="${type}" data-id="${id}" data-label="${esc(label)}" aria-label="Delete ${esc(label)}">Delete</button>`;}
function itemActions(type,id,label='record'){return `<span class="row-actions"><button class="edit-button" data-edit="${type}" data-id="${id}" aria-label="Edit ${esc(label)}">Edit</button>${itemDelete(type,id,label)}</span>`;}
function renderDashboard(){const s=state.summary;if(!s)return;$('#move-min').textContent=fmt(s.activity.minutes);$('#move-sessions').textContent=fmt(s.activity.count);$('#move-progress').style.width=`${pct(s.activity.minutes,30)}%`;$('#steps-today').textContent=fmt(s.activity.steps);$('#steps-progress').style.width=`${pct(s.activity.steps,state.user.steps_goal)}%`;$(`#steps-goal`).textContent=`of ${fmt(state.user.steps_goal)} goal`;$('#steps-week').textContent=fmt(s.week.reduce((a,b)=>a+Number(b.steps||0),0));
  $('#calories').textContent=fmt(s.nutrition.calories);$('#protein').textContent=`${fmt(s.nutrition.protein)}g`;$('#calorie-progress').style.width=`${pct(s.nutrition.calories,state.user.calories_goal)}%`;

  $('#weight').textContent=s.weight?fmt(s.weight.weight_kg,1):'—';$('#weight-date').textContent=s.weight?dateLabel(s.weight.logged_at):'log to see';
  const week=weekDates(today),map=new Map(s.week.map(x=>[x.date,x]));const weekValues=week.map(d=>Number(map.get(d.date)?.[state.chartMode]||0));$('#week-total').textContent=fmt(weekValues.reduce((a,b)=>a+b,0));$('#week-total-label').textContent=state.chartMode==='minutes'?'active min this week':'active kcal this week';$('#activity-chart').innerHTML=week.map((d,i)=>`<div class="chart-day ${d.date===today?'today':''}" title="${fmt(weekValues[i])} ${state.chartMode}"><span class="chart-value">${weekValues[i]?fmt(weekValues[i]):''}</span><div class="chart-bar-wrap"><i class="chart-bar" style="height:${weekValues[i]?Math.max(4,weekValues[i]/Math.max(1,...weekValues)*74):2}%"></i></div><span class="chart-day-label">${d.label}</span></div>`).join('');$('#activity-chart').setAttribute('aria-label',`${state.chartMode} for the last seven days`);
  $('#recent-activity').innerHTML=s.recent.length?s.recent.map(a=>`<div class="recent-item"><span class="list-icon">${activityIcon(a.activity_type)}</span><div class="recent-copy"><strong>${esc(a.activity_type)}</strong><span>${dateLabel(a.activity_date)} · ${fmt(a.duration_min)} min${a.distance_km?` · ${fmt(a.distance_km,1)} km`:''}</span></div><span class="recent-meta">${a.calories?`${fmt(a.calories)} kcal`:esc(a.intensity)}</span></div>`).join(''):empty('Your first activity is waiting.','Log a walk, workout or anything that gets you moving.');
  const goals=state.logs?.goals||[];$('#goal-preview').innerHTML=goals.length?goals.slice(0,2).map(g=>goalPreview(g)).join(''):empty('Start with a goal that feels right.','A gentle target can help you keep your intention in view.');}
function weekDates(end){const out=[];const d=new Date(`${end}T12:00:00`);d.setDate(d.getDate()-6);for(let i=0;i<7;i++){out.push({date:new Date(d).toISOString().slice(0,10),label:new Intl.DateTimeFormat(undefined,{weekday:'short'}).format(d).slice(0,2)});d.setDate(d.getDate()+1);}return out;}
function activityIcon(type){const t=String(type).toLowerCase();return t.includes('run')?'↗':t.includes('cycl')?'⟷':t.includes('yoga')?'✳':t.includes('swim')?'≈':t.includes('gym')?'◈':'⌖';}
function goalProgress(goal){const logs=state.logs;let val=0,percent=0;switch(goal.metric){case'weight_kg':{val=logs.body[0]?.weight_kg||0;const baseline=logs.body.at(-1)?.weight_kg??val;percent=baseline===goal.target?(val===goal.target?100:0):Math.max(0,Math.min(100,Math.round((baseline-val)/(baseline-goal.target)*100)));break;}case'workout_sessions':val=logs.workouts.filter(x=>x.workout_date>=weekDates(today)[0].date).length;break;default:val=logs.activities.filter(x=>x.activity_date>=weekDates(today)[0].date).reduce((a,x)=>a+x.duration_min,0);}if(goal.metric!=='weight_kg')percent=pct(val,goal.target);return {val,percent};}
function goalPreview(g){const p=goalProgress(g);return `<div class="goal-preview-row"><span class="goal-dot"></span><div><strong>${esc(g.title)}</strong><div class="goal-small-progress"><i style="width:${p.percent}%"></i></div><span>${fmt(p.val)} / ${fmt(g.target)} ${esc(g.unit)}</span></div><b>${p.percent}%</b></div>`;}
function renderActivities(){const logs=state.logs;if(!logs)return;const since=weekDates(today)[0].date;const week=logs.activities.filter(a=>a.activity_date>=since);$('#activity-week-min').textContent=fmt(week.reduce((a,x)=>a+x.duration_min,0));$('#activity-week-workouts').textContent=fmt(logs.workouts.filter(w=>w.workout_date>=since).length);$('#activity-week-steps').textContent=fmt(week.reduce((a,x)=>a+Number(x.steps||0),0));$('#activity-week-distance').textContent=fmt(week.reduce((a,x)=>a+Number(x.distance_km||0),0),1);const filter=$('#activity-filter').value;const rows=logs.activities.filter(a=>filter==='all'||(filter==='Other'?(a.activity_type==='Other'||a.activity_type.startsWith('Other: ')):a.activity_type===filter));$('#activity-table').innerHTML=rows.length?rows.map(a=>`<div class="log-row"><span class="list-icon">${activityIcon(a.activity_type)}</span><div class="log-copy"><strong>${esc(a.activity_type)} <span class="status-badge ${a.intensity.toLowerCase()}">${esc(a.intensity)}</span></strong><span>${dateLabel(a.activity_date)} · ${fmt(a.duration_min)} min${a.distance_km?` · ${fmt(a.distance_km,1)} km`:''}${a.steps?` · ${fmt(a.steps)} steps`:''}${a.notes?` · ${esc(a.notes)}`:''}</span></div><div class="recent-meta">${a.calories?`${fmt(a.calories)} kcal`:''}</div>${itemActions('activity',a.id,a.activity_type)}</div>`).join(''):empty('No movement logged yet.','Use Log activity to add an entry.');}
function renderWorkouts(){const list=state.logs?.workouts||[];$('#workout-list').innerHTML=list.length?list.map(w=>`<div class="log-row"><span class="list-icon">◈</span><div class="log-copy"><strong>${esc(w.title)}</strong><span>${dateLabel(w.workout_date)} &#183; ${fmt(w.set_count)} sets &#183; ${fmt(w.total_reps)} reps</span></div>${itemActions('workout',w.id,w.title)}</div>`).join(''):empty('Your workout history starts here.','Log a strength session with exercises, reps and weight.');renderExerciseCatalog();}
function renderExerciseCatalog(){const q=$('#exercise-search').value.toLowerCase();const items=state.catalog.exercises.filter(x=>`${x.name} ${x.muscle_group} ${x.equipment}`.toLowerCase().includes(q));$('#exercise-catalog').innerHTML=items.length?items.map(x=>`<article class="exercise-card"><strong>${esc(x.name)}</strong><span>${esc(x.muscle_group)} · ${esc(x.equipment)} · ${esc(x.difficulty)}</span><p>${esc(x.instructions)}</p></article>`).join(''):empty('No exercises found.');}
function renderNutrition(){const s=state.summary;if(!s)return;const n=s.nutrition,goal=Number(state.user.calories_goal);$('#nutrition-total').textContent=fmt(n.calories);$('#nutrition-remaining').textContent=fmt(Math.max(0,goal-n.calories));$('#calorie-ring').style.strokeDashoffset=383-(383*pct(n.calories,goal)/100);[['protein',n.protein],['carbs',n.carbs],['fat',n.fat]].forEach(([key,val])=>{$(`#macro-${key}`).style.width=`${pct(val,key==='protein'?120:key==='carbs'?250:70)}%`;$(`#macro-${key}-label`).textContent=`${fmt(val)}g`;});const filter=$('#meal-filter').value;const meals=state.logs?.meals||[];const shown=meals.filter(m=>filter==='all'||m.meal===filter);$('#meal-list').innerHTML=shown.length?shown.map(m=>`<div class="log-row"><span class="list-icon">◉</span><div class="log-copy"><strong>${esc(m.name)} <span class="meal-tag">${esc(m.meal)}</span></strong><span>${dateLabel(m.logged_at)} · ${fmt(m.servings,1)} serving${m.servings==1?'':'s'} · ${fmt(m.calories*m.servings)} kcal</span></div><div class="recent-meta">P ${fmt(m.protein*m.servings)}g<br/>C ${fmt(m.carbs*m.servings)}g</div>${itemActions('food',m.id,m.name)}</div>`).join(''):empty('No meals logged today.','Select a food from the library or add a custom food later.');renderFoodCatalog();}
function renderFoodCatalog(){const q=$('#food-search').value.toLowerCase();const foods=state.catalog.foods.filter(f=>`${f.name} ${f.category}`.toLowerCase().includes(q));$('#food-catalog').innerHTML=foods.map(f=>`<article class="food-card"><strong>${esc(f.name)}</strong><span>${esc(f.serving)} · ${fmt(f.calories)} kcal</span><span>${fmt(f.protein)}g protein · ${fmt(f.carbs)}g carbs</span></article>`).join('');}
function renderProgress(){const body=state.logs?.body||[];$('#body-list').innerHTML=body.length?body.map(b=>`<div class="log-row"><span class="list-icon">⌁</span><div class="log-copy"><strong>${fmt(b.weight_kg,1)} kg${b.waist_cm?` · waist ${fmt(b.waist_cm,1)} cm`:''}${b.hip_cm?` · hip ${fmt(b.hip_cm,1)} cm`:''}</strong><span>${dateLabel(b.logged_at)}</span></div>${itemActions('body',b.id,'body measurement')}</div>`).join(''):empty('Your body log is private and optional.','Only enter measurements you want to track.');const chronological=[...body].reverse();$('#weight-history').innerHTML=chronological.length?(()=>{const vals=chronological.map(x=>x.weight_kg),min=Math.min(...vals),max=Math.max(...vals);return chronological.slice(-8).map(x=>`<div class="weight-point"><b>${fmt(x.weight_kg,1)}</b><i style="height:${max===min?55:18+(x.weight_kg-min)/(max-min)*60}%"></i><span>${dateLabel(x.logged_at)}</span></div>`).join('');})():empty('Log a weight to begin a trend.');const goals=state.logs?.goals||[];$('#goal-list').innerHTML=goals.length?goals.map(g=>{const p=goalProgress(g);return `<div class="goal-row"><div class="goal-row-head"><strong>${esc(g.title)}</strong><span>${p.percent}%</span></div><div class="goal-meter"><i style="width:${p.percent}%"></i></div><div class="goal-meta"><span>${fmt(p.val)} / ${fmt(g.target)} ${esc(g.unit)}</span><span>${g.deadline?`Due ${dateLabel(g.deadline)}`:esc(g.metric.replace('_',' '))}</span></div>${itemActions('goal',g.id,g.title)}</div>`;}).join(''):empty('No goals yet.','Choose a target that feels achievable for you.');}
function sleepDuration(row){let start=new Date(`${row.sleep_date}T${row.bedtime}:00`),end=new Date(`${row.sleep_date}T${row.waketime}:00`);if(end<=start)end.setDate(end.getDate()+1);return Math.max(0,(end-start)/3600000);}
function renderWellness(){const rows=state.logs?.sleep||[];$('#sleep-list').innerHTML=rows.length?rows.map(x=>`<div class="log-row"><span class="list-icon">☾</span><div class="log-copy"><strong>${fmt(sleepDuration(x),1)} hrs · quality ${x.quality}/5</strong><span>${dateLabel(x.sleep_date)} · ${x.bedtime} – ${x.waketime} · energy ${x.energy}/5${x.notes?` · ${esc(x.notes)}`:''}</span></div>${itemActions('sleep',x.id,'sleep entry')}</div>`).join(''):empty('No sleep entries yet.','Log your times and subjective ratings when you’re ready.');}

function openDialog(title,kicker,html){$('#dialog-title').textContent=title;$('#dialog-kicker').textContent=kicker;dialogContent.innerHTML=html;dialog.showModal();$$('.close-dialog',dialog).forEach(b=>b.onclick=()=>dialog.close());}
function field(label,name,type='text',opts={}){const attr=Object.entries(opts).map(([k,v])=>`${k}="${esc(v)}"`).join(' ');return `<label>${label}<input name="${name}" type="${type}" ${attr}></label>`;}
function openForm(type,record=null){const date=nowLocal();let title='',kicker='',html='';
  if(type==='activity'){title='Log an activity';kicker='MOVE IN YOUR OWN WAY';html=`<form class="entry-form" data-submit="activity"><label>Activity<select name="type" required>${['Walking','Running','Cycling','Swimming','Gym','Yoga','HIIT','Other'].map(x=>`<option>${x}</option>`).join('')}</select></label><label>Date<input name="date" type="date" value="${date}" required></label><label class="hidden" data-other-activity-wrap>Describe the activity<input name="other_activity" maxlength="33" placeholder="e.g. Dancing"></label>${field('Duration (minutes)','duration','number',{min:1,max:1440,placeholder:'e.g. 30',required:true})}${field('Distance (km, optional)','distance','number',{min:0,max:2000,step:0.1,placeholder:'e.g. 5.2'})}${field('Steps (manual, optional)','steps','number',{min:0,max:200000,placeholder:'e.g. 8000'})}<label>Intensity<select name="intensity"><option>Easy</option><option selected>Moderate</option><option>Hard</option></select></label>${field('Estimated active calories (optional)','calories','number',{min:0,max:10000,placeholder:'e.g. 250'})}<label class="full">Notes<textarea name="notes" maxlength="500" placeholder="How did it feel?"></textarea></label><button class="button primary full" type="submit">Save activity</button></form>`;}
  if(type==='food'){title='Add to food diary';kicker='NOURISH YOUR DAY';html=`<form class="entry-form" data-submit="food"><label>Food<select name="food_id" required>${state.catalog.foods.map(f=>`<option value="${f.id}">${esc(f.name)} · ${fmt(f.calories)} kcal / ${esc(f.serving)}</option>`).join('')}</select></label><label>Meal<select name="meal"><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select></label>${field('Servings','servings','number',{min:0.05,max:50,step:0.25,placeholder:'e.g. 1',required:true})}<label>Date<input name="date" type="date" value="${date}" required></label><p class="small-note full">Macros are calculated from the chosen food's per-serving values.</p><button class="button primary full" type="submit">Save food log</button></form>`;}
  if(type==='body'){title='Log a measurement';kicker='ONLY WHAT YOU CHOOSE';html=`<form class="entry-form" data-submit="body"><label>Weight (kg)<input name="weight_kg" type="number" min="20" max="500" step="0.1" placeholder="e.g. 68.5" required></label><label>Date<input name="date" type="date" value="${date}" required></label>${field('Waist (cm, optional)','waist_cm','number',{min:20,max:300,step:0.1,placeholder:'e.g. 80'})}${field('Hip (cm, optional)','hip_cm','number',{min:20,max:300,step:0.1,placeholder:'e.g. 95'})}<p class="small-note full">Measurements are optional and visible only in your account.</p><button class="button primary full" type="submit">Save measurement</button></form>`;}
  if(type==='sleep'){title='Log last night';kicker='REST IS PART OF YOUR RHYTHM';html=`<form class="entry-form" data-submit="sleep"><label>Date<input name="date" type="date" value="${date}" required></label><label>Sleep quality<select name="quality">${[5,4,3,2,1].map(n=>`<option value="${n}">${n} · ${['','Rough','Low','Okay','Good','Great'][n]}</option>`).join('')}</select></label><label>Bedtime<input name="bedtime" type="time" required></label><label>Wake time<input name="waketime" type="time" required></label><label>Energy on waking<select name="energy">${[5,4,3,2,1].map(n=>`<option value="${n}">${n} / 5</option>`).join('')}</select></label><label class="full">Wellness note<textarea name="notes" maxlength="500" placeholder="Optional reflection"></textarea></label><button class="button primary full" type="submit">Save sleep log</button></form>`;}
  if(type==='goal'){title='Set a personal goal';kicker='A TARGET THAT FEELS RIGHT';html=`<form class="entry-form" data-submit="goal"><label class="full">Goal name<input name="title" maxlength="100" placeholder="Move a little more" required></label><label>Track<select name="metric"><option value="activity_minutes">Active minutes</option><option value="workout_sessions">Workout sessions</option><option value="weight_kg">Weight</option></select></label>${field('Target','target','number',{min:1,max:100000,placeholder:'e.g. 5',required:true})}<label>Unit<input name="unit" placeholder="e.g. min" maxlength="20" required></label><label>Deadline (optional)<input name="deadline" type="date"></label><button class="button primary full" type="submit">Save goal</button></form>`;}
  if(type==='workout'){title='Log a strength session';kicker='SHOW UP, SET BY SET';html=`<form class="entry-form" data-submit="workout"><label>Workout name<input name="title" maxlength="100" placeholder="Upper body A" required></label><label>Date<input name="date" type="date" value="${date}" required></label><label class="full">Session note<input name="notes" maxlength="500" placeholder="Optional"></label><div class="full"><div class="sets-heading"><strong>Exercise sets</strong><button id="add-set" class="inline-link" type="button">＋ Add set</button></div><div id="set-rows">${record?.sets?.length?record.sets.map((set,index)=>workoutSetRow(index+1,set)).join(''):workoutSetRow(1)}</div></div><button class="button primary full" type="submit">Save workout</button></form>`;}
  openDialog(record?`Edit ${title.toLowerCase().replace(/^(log|add|set)\s+/,'')}`:title,kicker,html);
  const form=$('form[data-submit]',dialogContent);
  if(type==='activity'&&form){const activityType=form.elements.namedItem('type'),otherWrap=$('[data-other-activity-wrap]',form),otherInput=form.elements.namedItem('other_activity');const syncOther=()=>{const show=activityType.value==='Other';otherWrap.classList.toggle('hidden',!show);otherInput.required=show;};activityType.addEventListener('change',syncOther);syncOther();}
  if(record&&form){form.dataset.recordId=record.id;const values=type==='activity'?{type:record.activity_type.startsWith('Other: ')?'Other':record.activity_type,other_activity:record.activity_type.startsWith('Other: ')?record.activity_type.slice(7):'',date:record.activity_date,duration:record.duration_min,distance:record.distance_km,steps:record.steps,intensity:record.intensity,calories:record.calories,notes:record.notes}:type==='food'?{food_id:record.food_id,meal:record.meal,servings:record.servings,date:record.logged_at.slice(0,10)}:type==='body'?{weight_kg:record.weight_kg,waist_cm:record.waist_cm,hip_cm:record.hip_cm,date:record.logged_at.slice(0,10)}:type==='sleep'?{date:record.sleep_date,bedtime:record.bedtime,waketime:record.waketime,quality:record.quality,energy:record.energy,notes:record.notes}:type==='goal'?{title:record.title,metric:record.metric,target:record.target,unit:record.unit,deadline:record.deadline||''}:{title:record.title,date:record.workout_date,notes:record.notes};for(const [name,value] of Object.entries(values)){const control=form.elements.namedItem(name);if(control&&value!==null&&value!==undefined)control.value=value;}if(type==='activity')form.elements.namedItem('type').dispatchEvent(new Event('change'));const submit=$('button[type=submit]',form);if(submit)submit.textContent='Save changes';}
  const addSet=$('#add-set');if(addSet)addSet.onclick=()=>{$('#set-rows').insertAdjacentHTML('beforeend',workoutSetRow($$('.set-row',dialogContent).length+1));};
}
function workoutSetRow(n,set={}){return `<div class="set-row"><select aria-label="Exercise for set ${n}" name="exercise_id" required>${state.catalog.exercises.map(x=>`<option value="${x.id}" ${Number(set.exercise_id)===Number(x.id)?'selected':''}>${esc(x.name)}</option>`).join('')}</select><input aria-label="Repetitions" name="reps" type="number" min="1" max="10000" value="${esc(set.reps??'')}" placeholder="Reps" required><input aria-label="Weight in kilograms" name="weight_kg" type="number" min="0" max="2000" step="0.5" value="${esc(set.weight_kg??'')}" placeholder="kg"></div>`;}
dialogContent.addEventListener('click',event=>{if(event.target.id==='add-set'){} });
dialogContent.addEventListener('submit',async event=>{const form=event.target.closest('form[data-submit]');if(!form)return;event.preventDefault();const type=form.dataset.submit;const body=Object.fromEntries(new FormData(form));try{
  let route=type==='activity'?'/api/activities':type==='food'?'/api/food-logs':type==='body'?'/api/body-metrics':type==='sleep'?'/api/sleep-logs':type==='goal'?'/api/goals':'/api/workouts';

  if(type==='workout'){const rows=$$('.set-row',form);body.sets=rows.map(row=>({exercise_id:$('[name=exercise_id]',row).value,reps:$('[name=reps]',row).value||null,weight_kg:$('[name=weight_kg]',row).value||null}));}
  const editRoute=type==='workout'?`/api/edit/workout/${form.dataset.recordId}`:`/api/edit/${type}/${form.dataset.recordId}`;await api(form.dataset.recordId?editRoute:route,{method:form.dataset.recordId?'PATCH':'POST',body:JSON.stringify(body)});dialog.close();form.reset();toast(form.dataset.recordId?'Changes saved.':'Saved to your Fitpath log.');await refresh();
}catch(error){let node=$('.form-error',form);if(!node){node=document.createElement('p');node.className='form-error full';form.append(node);}node.textContent=error.message;}});
$('#settings-link').addEventListener('click',()=>{setMenuOpen(false);if(!state.user)return;const f=$('#settings-form');f.name.value=state.user.name;f.steps_goal.value=state.user.steps_goal;f.calories_goal.value=state.user.calories_goal;$('#settings-error').textContent='';settingsDialog.showModal();});
$('#settings-link').addEventListener('click',()=>{setMenuOpen(false);if(!state.user)return;const f=$('#settings-form');f.name.value=state.user.name;f.steps_goal.value=state.user.steps_goal;f.calories_goal.value=state.user.calories_goal;$('#settings-error').textContent='';settingsDialog.showModal();});
$$('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{const r=await api('/api/profile',{method:'PATCH',body:JSON.stringify(body)});state.user=r.user;settingsDialog.close();renderAll();toast('Your preferences are saved.');}catch(err){$('#settings-error').textContent=err.message;}});
$('#delete-account').addEventListener('click',async()=>{const choice=await window.fitpathConfirm({title:'Delete your account?',message:'Permanently delete your account and all your logs? This cannot be undone.',confirmText:'Delete account',danger:true,requirePassword:true});if(!choice.confirmed)return;const password=choice.password;try{await api('/api/account',{method:'DELETE',body:JSON.stringify({password})});state.user=null;state.authMode='login';settingsDialog.close();showAuth();toast('Your account was deleted.');}catch(error){$('#settings-error').textContent=error.message;}});
document.addEventListener('click',async event=>{const btn=event.target.closest('[data-delete]');if(!btn)return;const choice=await window.fitpathConfirm({title:'Delete this entry?',message:'Delete this '+btn.dataset.label+'? This cannot be undone.',confirmText:'Delete entry',danger:true});if(!choice.confirmed)return;try{const route=btn.dataset.delete==='workouts'?`/api/workouts/${btn.dataset.id}`:`/api/delete/${btn.dataset.delete}/${btn.dataset.id}`;await api(route,{method:'DELETE'});toast('Entry deleted.');await refresh();}catch(error){toast(error.message);}});
$('#activity-filter').addEventListener('change',renderActivities);$('#meal-filter').addEventListener('change',renderNutrition);$('#food-search').addEventListener('input',renderFoodCatalog);$('#exercise-search').addEventListener('input',renderExerciseCatalog);$('#chart-mode').addEventListener('change',event=>{state.chartMode=event.target.value;renderDashboard();});
$('#rest-timer-button').addEventListener('click',()=>{let secs=60;const btn=$('#rest-timer-button');btn.textContent='Rest · 1:00';clearInterval(window.restInterval);window.restInterval=setInterval(()=>{secs--;if(secs<=0){clearInterval(window.restInterval);btn.textContent='Rest timer ⏱';toast('Rest is done. Ready when you are.');}else btn.textContent=`Rest · 0:${String(secs).padStart(2,'0')}`;},1000);});
function updateBmiPreview(){const height=Number($('#signup-height').value),weight=Number($('#signup-weight').value),output=$('#bmi-preview');if(height>=100&&height<=250&&weight>=20&&weight<=500)output.textContent=`${(weight/((height/100)**2)).toFixed(1)} kg/m2`;else output.textContent='Add height and weight to calculate';}
$('#signup-height').addEventListener('input',updateBmiPreview);$('#signup-weight').addEventListener('input',updateBmiPreview);
async function boot(){const hash=location.hash.slice(1);if(document.querySelector(`#page-${hash}`))state.page=hash;try{const me=await api('/api/me');if(me.user){state.user=me.user;await api('/api/catalog').then(c=>state.catalog=c);showApp();}else showAuth();}catch{showAuth();}}
boot();
