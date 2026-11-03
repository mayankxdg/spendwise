// Shared header/footer + fetch helper so every page looks like one project
async function api(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !location.pathname.endsWith('index.html') && location.pathname !== '/') location.href = '/index.html';
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function showAlert(el, msg, type = 'danger') { el.className = `alert alert-${type}`; el.textContent = msg; el.classList.remove('d-none'); }

function renderLayout(active, userName) {
  const links = [['dashboard.html','Dashboard'],['transactions.html','Transactions'],['budgets.html','Budgets']];
  document.getElementById('nav').innerHTML = `
  <nav class="navbar navbar-expand-md navbar-dark" aria-label="Main navigation"><div class="container">
    <a class="navbar-brand fw-bold" href="dashboard.html">💰 SpendWise</a>
    <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#menu" aria-label="Toggle menu"><span class="navbar-toggler-icon"></span></button>
    <div id="menu" class="collapse navbar-collapse"><ul class="navbar-nav me-auto">
      ${links.map(([h,t]) => `<li class="nav-item"><a class="nav-link ${h===active?'active':''}" href="${h}">${t}</a></li>`).join('')}
    </ul><span class="text-white me-3">Hi, ${esc(userName)}</span>
    <button id="logoutBtn" class="btn btn-sm btn-outline-light">Logout</button></div></div></nav>`;
  document.getElementById('foot').innerHTML = '<footer>SpendWise · Web Technology Mini Project (ICT3131) · MIT Manipal</footer>';
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/logout', 'POST'); location.href = '/index.html'; };
}
