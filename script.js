// --- GLOBAL DATA ---
let data = JSON.parse(localStorage.getItem('budgetApp_v3')) || {
    transactions: [],
    incomeSources: [{ id: 1, name: "Salariu", total: 0 }],
    savings: [],
    debts: [],
    monthlyBudgets: {}
};
let editModeId = null;
let myChart = null;

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Check PIN
    if(localStorage.getItem('budget_app_pin') && !sessionStorage.getItem('pin_verified')) {
        const overlay = document.getElementById('login-overlay');
        if(overlay) overlay.style.display = 'flex';
    }

    // 2. Theme
    if(localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');

    // 3. Month Filter Init
    const monthFilter = document.getElementById('month-filter');
    if(monthFilter) {
        if(!localStorage.getItem('current_month')) localStorage.setItem('current_month', new Date().toISOString().slice(0, 7));
        monthFilter.value = localStorage.getItem('current_month');
    }

    // 4. Page Specific Renders
    if(document.getElementById('view-home')) initHome();
    if(document.getElementById('view-transactions')) initTransactions();
    if(document.getElementById('view-accounts')) initAccounts();
    
    // 5. Service Worker
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
});

function saveData() {
    localStorage.setItem('budgetApp_v3', JSON.stringify(data));
    // Refresh current view
    if(document.getElementById('view-home')) updateDashboard();
    if(document.getElementById('view-transactions')) { renderTransactions(); renderCalendar(); }
    if(document.getElementById('view-accounts')) renderAllLists();
}

function applyMonthFilter() {
    const m = document.getElementById('month-filter').value;
    localStorage.setItem('current_month', m);
    location.reload(); // Simplest way to refresh all data across views
}

// --- HOME PAGE LOGIC ---
function initHome() {
    updateDashboard();
    // Setup Modal Triggers
    window.openTransactionModal = () => document.getElementById('transaction-modal').style.display = 'flex';
    window.closeTransactionModal = () => { document.getElementById('transaction-modal').style.display = 'none'; cancelEdit(); };
}

function updateDashboard() {
    const m = localStorage.getItem('current_month') || new Date().toISOString().slice(0, 7);
    let liquid = 0, totalInc = 0, planned = 0, paid = 0, remaining = 0, totalExpenses = 0;
    
    // Budget
    const budgetInput = document.getElementById('budget-input');
    if(budgetInput) {
        const budget = data.monthlyBudgets[m] !== undefined ? data.monthlyBudgets[m] : 8000;
        budgetInput.value = budget;
    }

    data.transactions.forEach(t => {
        if(t.checked) liquid += t.amount;
        if(t.date.startsWith(m)) {
            remaining += t.amount;
            if(t.amount > 0) { if(t.checked && t.type==='income') totalInc += t.amount; }
            else {
                totalExpenses += Math.abs(t.amount);
                if(t.checked) paid += Math.abs(t.amount); else planned += Math.abs(t.amount);
            }
        }
    });

    // Update DOM
    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val.toFixed(2) + ' RON'; };
    setTxt('dash-income', totalInc); setTxt('dash-planned', planned);
    setTxt('dash-paid', paid); setTxt('dash-balance', liquid);
    
    const remEl = document.getElementById('dash-remaining');
    if(remEl) {
        remEl.innerText = remaining.toFixed(2) + ' RON';
        remEl.className = remaining >= 0 ? 'stat-value text-teal' : 'stat-value text-red';
    }

    // Chart
    const ctx = document.getElementById('expenseChart');
    if(ctx) {
        let stats = { expense: 0, credit: 0, savings: 0 };
        data.transactions.forEach(t => {
            if(t.date.startsWith(m)) {
                if(t.type === 'expense') stats.expense += Math.abs(t.amount);
                if(t.type === 'credit_payment') stats.credit += Math.abs(t.amount);
                if(t.type === 'savings_in') stats.savings += Math.abs(t.amount);
            }
        });
        if(myChart) myChart.destroy();
        myChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Cheltuieli', 'Rate', 'Economii'],
                datasets: [{ data: [stats.expense, stats.credit, stats.savings], backgroundColor: ['#f59e0b', '#ef4444', '#14b8a6'] }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
    }
}

function updateBudgetLimit() {
    const m = localStorage.getItem('current_month');
    const val = parseFloat(document.getElementById('budget-input').value);
    if(!isNaN(val)) data.monthlyBudgets[m] = val; else delete data.monthlyBudgets[m];
    saveData();
}

// --- TRANSACTIONS PAGE LOGIC ---
function initTransactions() {
    renderTransactions();
    renderCalendar();
    // Setup Modal Triggers
    window.openTransactionModal = () => document.getElementById('transaction-modal').style.display = 'flex';
    window.closeTransactionModal = () => { document.getElementById('transaction-modal').style.display = 'none'; cancelEdit(); };
}

function renderTransactions() {
    const list = document.getElementById('transaction-list');
    if(!list) return;
    list.innerHTML = '';
    const m = localStorage.getItem('current_month');
    const filtered = data.transactions.filter(t => t.date.startsWith(m)).sort((a,b) => new Date(a.date) - new Date(b.date));
    
    filtered.forEach(t => {
        const tr = document.createElement('tr');
        if(t.checked) tr.classList.add('row-paid');
        let icon = '', color = '';
        switch(t.type) {
            case 'income': icon='<i class="fas fa-arrow-up text-green"></i>'; color='text-green'; break;
            case 'expense': icon='<i class="fas fa-arrow-down text-red"></i>'; color='text-red'; break;
            case 'savings_in': icon='<i class="fas fa-piggy-bank text-teal"></i>'; color='text-teal'; break;
            case 'savings_out': icon='<i class="fas fa-wallet text-blue"></i>'; color='text-blue'; break;
            case 'credit_payment': icon='<i class="fas fa-university text-orange"></i>'; color='text-red'; break;
        }
        tr.innerHTML = `
            <td class="check-col"><input type="checkbox" ${t.checked ? 'checked' : ''} onchange="toggleCheck(${t.id})"></td>
            <td>${t.date.slice(8)}</td>
            <td><div>${icon} ${t.desc}</div></td>
            <td class="amount-col ${color}">${t.amount.toFixed(2)}</td>
            <td><button class="btn-icon" onclick="editTransaction(${t.id})"><i class="fas fa-pen"></i></button>
                <button class="btn-icon del" onclick="deleteTransaction(${t.id})"><i class="fas fa-trash"></i></button></td>`;
        list.appendChild(tr);
    });
}

function renderCalendar() {
    const calView = document.getElementById('calendar-view');
    if(!calView) return;
    calView.innerHTML = '';
    const m = localStorage.getItem('current_month');
    const [year, month] = m.split('-').map(Number);
    ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'].forEach(d => calView.innerHTML += `<div class="calendar-header">${d}</div>`);
    
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let startDay = firstDay.getDay() - 1; if (startDay === -1) startDay = 6;

    for(let i=0; i<startDay; i++) calView.innerHTML += `<div></div>`;
    for(let i=1; i<=lastDay.getDate(); i++) {
        const dateStr = `${m}-${String(i).padStart(2, '0')}`;
        const dayTxs = data.transactions.filter(t => t.date === dateStr);
        let dots = '';
        dayTxs.forEach(t => dots += `<div class="dot ${t.amount>0?'dot-green':'dot-red'}"></div>`);
        const el = document.createElement('div'); el.className = 'calendar-day';
        el.innerHTML = `<span class="day-number">${i}</span><div class="dots">${dots}</div>`;
        calView.appendChild(el);
    }
}

// --- ACCOUNTS PAGE LOGIC ---
function initAccounts() { renderAllLists(); }

function renderAllLists() {
    const render = (id, list, type, color) => {
        const el = document.getElementById(id); if(!el) return;
        el.innerHTML = '';
        let total = 0;
        list.forEach(item => {
            const val = type==='income' ? item.total : item.balance;
            total += val;
            el.innerHTML += `
                <div class="account-item">
                    <div class="account-info"><h4>${item.name}</h4><small>Sold: <span class="${color}">${val.toFixed(2)}</span></small></div>
                    <div class="actions"><button class="btn-icon" onclick="editAccount('${type}', ${item.id})"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon del" onclick="deleteAccount('${type}', ${item.id})"><i class="fas fa-times"></i></button></div>
                </div>`;
        });
        const totEl = document.getElementById('total-'+(type==='savings'?'savings':'debts'));
        if(totEl) totEl.innerText = total.toFixed(2);
    };
    render('list-income-sources', data.incomeSources, 'income', 'text-green');
    render('list-savings', data.savings, 'savings', 'text-teal');
    render('list-debts', data.debts, 'debt', 'text-red');
}

// --- SHARED ACTIONS (Add/Edit/Delete) ---
function toggleCheck(id) {
    const t = data.transactions.find(x => x.id === id);
    if(t) { t.checked = !t.checked; saveData(); }
}
function deleteTransaction(id) {
    if(confirm('Ștergi?')) { data.transactions = data.transactions.filter(x => x.id !== id); saveData(); }
}
function addAccount(type) {
    const n = prompt('Nume:'); if(!n) return;
    const item = { id: Date.now(), name: n };
    if(type!=='income') item.balance = parseFloat(prompt('Sold:')||0); else item.total = 0;
    if(type==='income') data.incomeSources.push(item);
    else if(type==='savings') data.savings.push(item);
    else data.debts.push(item);
    saveData();
}
function deleteAccount(type, id) {
    if(!confirm('Ștergi?')) return;
    if(type==='income') data.incomeSources = data.incomeSources.filter(x=>x.id!==id);
    else if(type==='savings') data.savings = data.savings.filter(x=>x.id!==id);
    else data.debts = data.debts.filter(x=>x.id!==id);
    saveData();
}

// --- FORM HANDLING (Modal) ---
function updateFormUI() {
    const type = document.getElementById('t-type').value;
    ['income','savings','credit'].forEach(k => document.getElementById('section-'+k).style.display='none');
    if(type==='income') document.getElementById('section-income').style.display='block';
    if(type.includes('savings')) document.getElementById('section-savings').style.display='block';
    if(type==='credit_payment') document.getElementById('section-credit').style.display='block';
}

// Populate Selects when Modal Opens
function updateSelects() {
    const fill = (id, list) => {
        const sel = document.getElementById(id); if(!sel) return;
        sel.innerHTML = '';
        list.forEach(i => { const opt = document.createElement('option'); opt.value=i.id; opt.text=i.name; sel.appendChild(opt); });
    };
    fill('t-income-source', data.incomeSources);
    fill('t-savings-account', data.savings);
    fill('t-credit-account', data.debts);
}

// Form Submit
const form = document.getElementById('transaction-form');
if(form) {
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if(editModeId) deleteTransaction(editModeId); // Simple edit: delete old, add new
        
        const type = document.getElementById('t-type').value;
        const amt = parseFloat(document.getElementById('t-amount').value);
        const finalAmt = ['expense','savings_in','credit_payment'].includes(type) ? -amt : amt;
        
        const t = {
            id: Date.now(),
            date: document.getElementById('t-date').value,
            desc: document.getElementById('t-desc').value,
            amount: finalAmt,
            type: type,
            checked: document.getElementById('t-date').value <= new Date().toISOString().split('T')[0],
            meta: {} // Simplified for brevity
        };
        data.transactions.push(t);
        saveData();
        closeTransactionModal();
        form.reset();
    });
}

function editTransaction(id) {
    const t = data.transactions.find(x => x.id === id); if(!t) return;
    editModeId = id;
    openTransactionModal();
    document.getElementById('t-date').value = t.date;
    document.getElementById('t-desc').value = t.desc;
    document.getElementById('t-amount').value = Math.abs(t.amount);
    document.getElementById('t-type').value = t.type;
    updateFormUI(); updateSelects();
}
function cancelEdit() { editModeId = null; if(form) form.reset(); }

// --- SETTINGS ---
function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}
function exportData() {
    const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
    a.download = "backup.json"; document.body.appendChild(a); a.click(); a.remove();
}
function setPin() {
    const p = prompt("PIN Nou:");
    if(p) localStorage.setItem('budget_app_pin', p); else localStorage.removeItem('budget_app_pin');
}
function verifyPin() {
    if(document.getElementById('pin-input').value === localStorage.getItem('budget_app_pin')) {
        document.getElementById('login-overlay').style.display = 'none';
        sessionStorage.setItem('pin_verified', 'true');
    } else alert('PIN Incorect');
}
