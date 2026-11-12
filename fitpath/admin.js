const $=selector=>document.querySelector(selector);
const loginPanel=$('#login-panel'),dashboard=$('#dashboard'),loginForm=$('#login-form');
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
async function api(url,options={}){const response=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Request failed.');return data;}
function showLogin(message=''){loginPanel.classList.remove('hidden');dashboard.classList.add('hidden');$('#login-error').textContent=message;}
function formatLastActivity(value){if(!value)return 'Not recorded';const date=new Date(value);return Number.isNaN(date.valueOf())?'Not recorded':date.toLocaleString([], {dateStyle:'medium',timeStyle:'short'});}
function showDashboard(user){loginPanel.classList.add('hidden');dashboard.classList.remove('hidden');$('#admin-greeting').textContent='Signed in as '+user.name+' · '+user.email;}
async function loadDashboard(){
  const [summary,result]=await Promise.all([api('/api/admin/summary'),api('/api/admin/users')]);
  $('#user-count').textContent=summary.users;
  $('#activity-count').textContent=summary.activity_logs;
  $('#workout-count').textContent=summary.workouts;
  $('#users-body').innerHTML=result.users.length?result.users.map(user=>{
    const action=user.role==='admin'?'<span class="protected">Protected</span>':'<button class="danger delete-user" data-user-id="'+Number(user.id)+'" data-user-name="'+escapeHtml(user.name)+'">Delete</button>';
    return '<tr><td>'+escapeHtml(user.name)+'</td><td>'+escapeHtml(user.email)+'</td><td><span class="role '+(user.role==='admin'?'admin':'')+'">'+escapeHtml(user.role)+'</span></td><td>'+escapeHtml(new Date(user.created_at+'Z').toLocaleDateString())+'</td><td>'+escapeHtml(formatLastActivity(user.last_active_at))+'</td><td>'+action+'</td></tr>';
  }).join(''):'<tr><td colspan="6">No accounts yet.</td></tr>';
}
async function enterAdmin(user){if(!user||user.role!=='admin'){showLogin('This account does not have admin access.');return;}showDashboard(user);try{await loadDashboard();}catch(error){$('#dashboard-error').textContent=error.message;}}
loginForm.addEventListener('submit',async event=>{event.preventDefault();$('#login-error').textContent='';const body=Object.fromEntries(new FormData(loginForm));try{await api('/api/login',{method:'POST',body:JSON.stringify(body)});const me=await api('/api/me');if(!me.user||me.user.role!=='admin'){await api('/api/logout',{method:'POST'});showLogin('This account does not have admin access.');return;}await enterAdmin(me.user);}catch(error){showLogin(error.message);}});
$('#users-body').addEventListener('click',async event=>{
  const button=event.target.closest('button.delete-user');
  if(!button)return;
  const userId=button.dataset.userId;
  const name=button.dataset.userName;
  if(!window.confirm('Permanently delete '+name+' and all of this account’s fitness logs? This cannot be undone.'))return;
  button.disabled=true;
  try{
    $('#dashboard-error').textContent='';
    await api('/api/admin/users/'+encodeURIComponent(userId),{method:'DELETE'});
    await loadDashboard();
  }catch(error){
    $('#dashboard-error').textContent=error.message;
    button.disabled=false;
  }
});
$('#refresh').addEventListener('click',async()=>{try{$('#dashboard-error').textContent='';await loadDashboard();}catch(error){$('#dashboard-error').textContent=error.message;}});
$('#signout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}finally{loginForm.reset();showLogin('You have signed out.');}});
(async()=>{try{const me=await api('/api/me');if(me.user)await enterAdmin(me.user);else showLogin();}catch{showLogin();}})();