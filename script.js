// --- GLOBAL DATA ---
let data = JSON.parse(localStorage.getItem('budgetApp_v3')) || {
    transactions: [],
    incomeSources: [],
    savings: [],
    debts: [],
    monthlyBudgets: {}
};

// Migrare date vechi
if (!data.categories) {
    data.categories = ["Alimente", "Transport", "Utilități", "Locuință", "Distracție", "Sănătate", "Educație", "Altele"];
}
if (!data.currency) {
    data.currency = 'RON';
}

let editModeId = null;
let myChart = null;

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Check PIN
    if(localStorage.getItem('budget_app_pin') && !sessionStorage.getItem('pin_verified')) {
        const overlay = document.getElementById('login-overlay');
        if(overlay) {
            overlay.style.display = 'flex';
            const savedUser = localStorage.getItem('budget_app_user');
            if(savedUser) document.getElementById('login-greeting').innerText = `Salut, ${savedUser}!`;
        }
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
    if(document.getElementById('view-settings')) initSettings();
    
    // 5. Service Worker
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

    // 6. Init Sounds
    initSoundEffects();

    // 7. Init Notifications System
    initNotifications();

    // 8. Hide Loader
    const loader = document.getElementById('app-loader');
    if(loader) {
        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => loader.style.visibility = 'hidden', 500);
        }, 600);
    }

    // 9. Account Form Listener
    const accForm = document.getElementById('account-form');
    if(accForm) {
        accForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('acc-id').value;
            const type = document.getElementById('acc-type').value;
            const name = document.getElementById('acc-name').value;
            const balance = parseFloat(document.getElementById('acc-balance').value) || 0;
            const icon = document.querySelector('input[name="acc-icon"]:checked').value;

            if (id) {
                let list = (type === 'income') ? data.incomeSources : (type === 'savings' ? data.savings : data.debts);
                const item = list.find(x => x.id == id);
                if(item) {
                    item.name = name;
                    item.icon = icon;
                    if(type !== 'income') item.balance = balance;
                }
            } else {
                const item = { id: Date.now(), name: name, icon: icon };
                if(type !== 'income') item.balance = balance; else item.total = 0;
                if(type === 'income') data.incomeSources.push(item); else if(type === 'savings') data.savings.push(item); else data.debts.push(item);
            }
            saveData();
            closeAccountModal();
            accForm.reset();
            showToast('Cont salvat cu succes!', 'success');
        });
    }

    // 10. Credit Auto-Calc
    const tAmount = document.getElementById('t-amount');
    const tPrincipal = document.getElementById('t-principal');
    const tInterest = document.getElementById('t-interest');

    if(tAmount && tPrincipal && tInterest) {
        const calc = (source) => {
            const type = document.getElementById('t-type').value;
            if(type !== 'credit_payment') return;

            const a = parseFloat(tAmount.value);
            const p = parseFloat(tPrincipal.value);
            const i = parseFloat(tInterest.value);

            if (source === 'principal' || source === 'interest') {
                if (!isNaN(p) && !isNaN(i)) tAmount.value = (p + i).toFixed(2);
                else if (!isNaN(a) && !isNaN(i) && source === 'interest') tPrincipal.value = (a - i).toFixed(2);
                else if (!isNaN(a) && !isNaN(p) && source === 'principal') tInterest.value = (a - p).toFixed(2);
            } else if (source === 'amount') {
                if (!isNaN(a) && !isNaN(i)) tPrincipal.value = (a - i).toFixed(2);
                else if (!isNaN(a) && !isNaN(p)) tInterest.value = (a - p).toFixed(2);
            }
        };
        tAmount.addEventListener('input', () => calc('amount'));
        tPrincipal.addEventListener('input', () => calc('principal'));
        tInterest.addEventListener('input', () => calc('interest'));
    }

    // 11. Global Click for Combobox
    document.addEventListener('click', (e) => {
        const inputs = document.querySelectorAll('#t-category');
        inputs.forEach(input => {
            const dropdown = input.nextElementSibling;
            if (dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    });
});

function saveData() {
    localStorage.setItem('budgetApp_v3', JSON.stringify(data));
    if(document.getElementById('view-home')) updateDashboard();
    if(document.getElementById('view-transactions')) { renderTransactions(); renderCalendar(); }
    if(document.getElementById('view-accounts')) renderAllLists();
}

function applyMonthFilter() {
    const m = document.getElementById('month-filter').value;
    localStorage.setItem('current_month', m);
    location.reload();
}

// --- HOME PAGE LOGIC ---
function initHome() {
    updateDashboard();
    setupCategoryCombobox();
    renderEvolutionChart();
    checkDailyAlerts();
    window.openTransactionModal = () => {
        document.getElementById('transaction-modal').style.display = 'flex';
        const d = new Date();
        if(!editModeId) {
            document.getElementById('t-date').value = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            updateFormUI();
            updateSelects();
            resetRecurrenceForm();
        }
    };
    window.closeTransactionModal = () => { document.getElementById('transaction-modal').style.display = 'none'; cancelEdit(); };
}

function checkDailyAlerts() {
    const container = document.getElementById('daily-alerts');
    if(!container) return;
    container.innerHTML = '';
    const cur = data.currency || 'RON';

    const today = new Date().toISOString().split('T')[0];
    const due = data.transactions.filter(t => 
        t.date === today && 
        !t.checked && 
        ['expense', 'credit_payment', 'savings_in'].includes(t.type)
    );

    if(due.length > 0) {
        let itemsHtml = due.map(t => `
            <div class="flex-between" style="padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid var(--border);">
                <span style="font-weight:500;">${t.desc}</span>
                <span class="font-bold text-red">${Math.abs(t.amount).toFixed(2)} ${cur}</span>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="card" style="border-left: 4px solid var(--orange);">
                <h3 style="border:none; padding:0; margin-bottom:15px; color: var(--orange);">
                    <span><i class="fas fa-bell"></i> De plată astăzi (${due.length})</span>
                </h3>
                <div class="flex-col gap-10">
                    ${itemsHtml}
                </div>
            </div>
        `;
    }
}

function updateDashboard() {
    const m = localStorage.getItem('current_month') || new Date().toISOString().slice(0, 7);
    let liquid = 0, totalInc = 0, planned = 0, paid = 0, remaining = 0, totalExpenses = 0;
    const cur = data.currency || 'RON';
    
    const budgetInput = document.getElementById('budget-input');
    if(budgetInput) {
        const budget = data.monthlyBudgets[m] !== undefined ? data.monthlyBudgets[m] : 0;
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

    const setTxt = (id, val) => { const el = document.getElementById(id); if(el) el.innerText = val.toFixed(2) + ' ' + cur; };
    setTxt('dash-income', totalInc); 
    setTxt('dash-planned', planned);
    setTxt('dash-paid', paid); setTxt('dash-balance', liquid);
    
    const remEl = document.getElementById('dash-remaining');
    if(remEl) {
        remEl.innerText = remaining.toFixed(2) + ' ' + cur;
        remEl.className = remaining >= 0 ? 'stat-value text-teal' : 'stat-value text-red';
    }

    const ctx = document.getElementById('expenseChart');
    if(ctx) {
        let stats = { credit: 0, savings: 0 };
        let expenseCats = {};

        data.transactions.forEach(t => {
            if(t.date.startsWith(m)) {
                if(t.type === 'expense') {
                    let cat = t.category || 'Altele';
                    expenseCats[cat] = (expenseCats[cat] || 0) + Math.abs(t.amount);
                }
                if(t.type === 'credit_payment') stats.credit += Math.abs(t.amount);
                if(t.type === 'savings_in') stats.savings += Math.abs(t.amount);
            }
        });

        const labels = [...Object.keys(expenseCats), 'Rate', 'Economii'];
        const dataValues = [...Object.values(expenseCats), stats.credit, stats.savings];
        const baseColors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#6366f1', '#f97316', '#64748b'];
        const bgColors = [...baseColors.slice(0, Object.keys(expenseCats).length), '#ef4444', '#14b8a6'];

        if(myChart) myChart.destroy();
        myChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{ 
                    data: dataValues, 
                    backgroundColor: bgColors,
                    borderWidth: 0,
                    hoverOffset: 10,
                    borderRadius: 20,
                    spacing: 5
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '75%',
                plugins: { 
                    legend: { 
                        position: 'bottom',
                        labels: { usePointStyle: true, padding: 20, font: { size: 12, family: "'Segoe UI', sans-serif" } }
                    } 
                } 
            }
        });
    }
}

function renderEvolutionChart() {
    const ctx = document.getElementById('evolutionChart');
    if(!ctx) return;

    const months = [];
    const balances = [];
    const today = new Date();
    
    for(let i=11; i>=0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthKey = d.toISOString().slice(0, 7);
        months.push(monthKey);
        
        let bal = 0;
        data.transactions.forEach(t => {
            if(t.checked && t.date.slice(0, 7) <= monthKey) {
                bal += t.amount;
            }
        });
        balances.push(bal);
    }

    new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: months,
            datasets: [{
                label: 'Sold Lichid',
                data: balances,
                borderColor: '#00f3ff',
                backgroundColor: 'rgba(0, 243, 255, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
            scales: {
                y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#9ca3af' } },
                x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
            }
        }
    });
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
    setupCategoryCombobox();
    renderCalendar();
    window.openTransactionModal = () => {
        document.getElementById('transaction-modal').style.display = 'flex';
        const d = new Date();
        if(!editModeId) {
            document.getElementById('t-date').value = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
            updateFormUI();
            updateSelects();
            resetRecurrenceForm();
        }
    };
    window.closeTransactionModal = () => { document.getElementById('transaction-modal').style.display = 'none'; cancelEdit(); };
}

function renderTransactions() {
    const list = document.getElementById('transaction-list');
    if(!list) return;
    list.innerHTML = '';
    const cur = data.currency || 'RON';
    const m = localStorage.getItem('current_month');
    
    const searchInput = document.getElementById('search-input');
    const query = searchInput ? searchInput.value.toLowerCase() : '';

    const filtered = data.transactions.filter(t => {
        const inMonth = t.date.startsWith(m);
        const matches = !query || t.desc.toLowerCase().includes(query) || t.amount.toString().includes(query) || (t.category && t.category.toLowerCase().includes(query));
        return inMonth && matches;
    }).sort((a,b) => new Date(a.date) - new Date(b.date));
    
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
            <td class="amount-col ${color}">${t.amount.toFixed(2)} ${cur}</td>
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
        el.onclick = () => openDayModal(dateStr);
    }
}

// --- ACCOUNTS PAGE LOGIC ---
function initAccounts() { renderAllLists(); }

function renderAllLists() {
    const cur = data.currency || 'RON';
    const render = (id, list, type, color) => {
        const el = document.getElementById(id); if(!el) return;
        el.innerHTML = '';
        let total = 0;
        list.forEach(item => {
            const val = type==='income' ? item.total : item.balance;
            total += val;
            const iconClass = item.icon || (type==='income' ? 'fa-wallet' : (type==='savings' ? 'fa-piggy-bank' : 'fa-university'));
            el.innerHTML += `
                <div class="account-item">
                    <div class="account-info" style="display:flex; align-items:center; gap:12px;"><i class="fas ${iconClass} ${color}" style="font-size:1.3rem; width:25px; text-align:center;"></i><div><h4>${item.name}</h4><small>Sold: <span class="${color}">${val.toFixed(2)} ${cur}</span></small></div></div>
                    <div class="actions"><button class="btn-icon" onclick="editAccount('${type}', ${item.id})"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon del" onclick="deleteAccount('${type}', ${item.id})"><i class="fas fa-times"></i></button></div>
                </div>`;
        });
        const suffix = type === 'income' ? 'income' : (type === 'savings' ? 'savings' : 'debts');
        const totEl = document.getElementById('total-' + suffix);
        if(totEl) totEl.innerText = total.toFixed(2) + ' ' + cur;
    };
    render('list-income-sources', data.incomeSources, 'income', 'text-green');
    render('list-savings', data.savings, 'savings', 'text-teal');
    render('list-debts', data.debts, 'debt', 'text-red');
}

// --- SHARED ACTIONS ---
function toggleCheck(id) {
    const t = data.transactions.find(x => x.id === id);
    if(t) { t.checked = !t.checked; saveData(); }
}
function deleteTransaction(id) {
    const t = data.transactions.find(x => x.id === id);
    if(!t) return;

    if (t.seriesId) {
        showRecurringDeletePrompt(() => {
            data.transactions = data.transactions.filter(x => x.id !== id);
            saveData();
            showToast('Tranzacție ștearsă.', 'info');
        }, () => {
            data.transactions = data.transactions.filter(x => {
                if (x.seriesId === t.seriesId && x.date >= t.date && x.id >= t.id) return false;
                return true;
            });
            saveData();
            showToast('Serie ștearsă (de la această dată).', 'info');
        });
    } else {
        showConfirm('Ești sigur că vrei să ștergi această tranzacție?', () => {
            data.transactions = data.transactions.filter(x => x.id !== id);
            saveData();
            showToast('Tranzacție ștearsă.', 'info');
        });
    }
}
function addAccount(type) { openAccountModal(type); }
function deleteAccount(type, id) {
    showConfirm('Ștergi acest cont? Datele asociate se pot pierde.', () => {
        if(type==='income') data.incomeSources = data.incomeSources.filter(x=>x.id!==id);
        else if(type==='savings') data.savings = data.savings.filter(x=>x.id!==id);
        else data.debts = data.debts.filter(x=>x.id!==id);
        saveData();
        showToast('Cont șters.', 'info');
    });
}
function editAccount(type, id) { openAccountModal(type, id); }

function openAccountModal(type, id = null) {
    const modal = document.getElementById('account-modal');
    if(!modal) return;
    
    document.getElementById('acc-type').value = type;
    document.getElementById('acc-id').value = id || '';
    document.getElementById('acc-modal-title').innerText = id ? 'Editează Cont' : 'Adaugă Cont';
    
    const balGroup = document.getElementById('acc-balance-group');
    if(balGroup) balGroup.style.display = (type === 'income') ? 'none' : 'block';

    if (id) {
        let list = (type === 'income') ? data.incomeSources : (type === 'savings' ? data.savings : data.debts);
        const item = list.find(x => x.id == id);
        if(item) {
            document.getElementById('acc-name').value = item.name;
            document.getElementById('acc-balance').value = (type !== 'income') ? item.balance : '';
            const iconVal = item.icon || 'fa-wallet';
            const radio = document.querySelector(`input[name="acc-icon"][value="${iconVal}"]`);
            if(radio) radio.checked = true;
        }
    } else {
        document.getElementById('acc-name').value = '';
        document.getElementById('acc-balance').value = '';
        document.querySelector('input[name="acc-icon"][value="fa-wallet"]').checked = true;
    }
    modal.style.display = 'flex';
}
function closeAccountModal() { document.getElementById('account-modal').style.display = 'none'; }

// --- FORM HANDLING ---
function updateFormUI() {
    const type = document.getElementById('t-type').value;
    ['income','savings','credit','expense'].forEach(k => document.getElementById('section-'+k).style.display='none');
    
    if(type==='expense') document.getElementById('section-expense').style.display='block';
    if(type==='income') document.getElementById('section-income').style.display='block';
    if(type.includes('savings')) document.getElementById('section-savings').style.display='block';
    if(type==='credit_payment') document.getElementById('section-credit').style.display='block';
}

function toggleRecurrenceOptions() {
    const isRec = document.getElementById('t-is-recurring').checked;
    document.getElementById('section-recurrence').style.display = isRec ? 'block' : 'none';
}

function resetRecurrenceForm() {
    document.getElementById('t-is-recurring').checked = false;
    toggleRecurrenceOptions();
}

function updateSelects() {
    const fill = (id, list) => {
        const sel = document.getElementById(id); if(!sel) return;
        sel.innerHTML = '';
        list.forEach(i => { const opt = document.createElement('option'); opt.value=i.id; opt.text=i.name; sel.appendChild(opt); });
    };
    fill('t-income-source', data.incomeSources);
    fill('t-savings-account', data.savings);
    fill('t-credit-account', data.debts);
    setupCategoryCombobox();
}

const form = document.getElementById('transaction-form');
if(form) {
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        handleTransactionSubmit();
    });
}

function handleTransactionSubmit() {
    const type = document.getElementById('t-type').value;
    const amt = parseFloat(document.getElementById('t-amount').value);
    const cat = document.getElementById('t-category').value;
    const principal = parseFloat(document.getElementById('t-principal').value) || 0;
    const interest = parseFloat(document.getElementById('t-interest').value) || 0;
    const desc = document.getElementById('t-desc').value;
    const dateVal = document.getElementById('t-date').value;
    const finalAmt = ['expense','savings_in','credit_payment'].includes(type) ? -amt : amt;
    
    let accountId = null;
    if (type === 'credit_payment') accountId = document.getElementById('t-credit-account').value;
    else if (type === 'income') accountId = document.getElementById('t-income-source').value;
    else if (type.includes('savings')) accountId = document.getElementById('t-savings-account').value;

    if (editModeId) {
        const origT = data.transactions.find(x => x.id === editModeId);
        if (origT) {
            const updateT = (t, updateDate = false) => {
                if(updateDate) t.date = dateVal;
                t.desc = desc;
                t.amount = finalAmt;
                t.type = type;
                t.category = (type === 'expense') ? cat : null;
                t.meta = (type === 'credit_payment') ? { principal, interest } : {};
                t.accountId = accountId;
                t.checked = updateDate ? (dateVal <= new Date().toISOString().split('T')[0]) : t.checked;
                
                const isRec = document.getElementById('t-is-recurring').checked;
                if (isRec && !t.seriesId) {
                    t.seriesId = Date.now();
                    generateFutureTransactions(t, true);
                }
            };

            const finishEdit = (msg) => {
                saveData();
                closeTransactionModal();
                form.reset();
                showToast(msg, 'success');
            };

            if (origT.seriesId) {
                showRecurringEditPrompt(() => {
                    updateT(origT, true);
                    finishEdit('Tranzacție actualizată!');
                }, () => {
                    const futureTxs = data.transactions.filter(x => x.seriesId === origT.seriesId && x.date >= origT.date && x.id >= origT.id);
                    futureTxs.forEach(t => updateT(t, false));
                    finishEdit('Serie actualizată!');
                });
                return;
            } else {
                updateT(origT, true);
                finishEdit('Tranzacție actualizată!');
                return;
            }
        }
    }

    const isRec = document.getElementById('t-is-recurring').checked;
    const seriesId = isRec ? Date.now() : null;
    
    const t = {
        id: Date.now(),
        date: dateVal,
        desc: desc,
        amount: finalAmt,
        type: type,
        checked: !isRec && dateVal <= new Date().toISOString().split('T')[0],
        category: (type === 'expense') ? cat : null,
        meta: (type === 'credit_payment') ? { principal: principal, interest: interest } : {},
        seriesId: seriesId,
        accountId: accountId
    };
    data.transactions.push(t);

    if (isRec) {
        generateFutureTransactions(t, false);
    }
    
    if (!isRec && t.date <= new Date().toISOString().split('T')[0]) t.checked = true;

    saveData();
    closeTransactionModal();
    form.reset();
    showToast('Tranzacție salvată!', 'success');
}

function generateFutureTransactions(baseT, skipFirst) {
    const recFreq = document.getElementById('t-rec-freq').value;
    let recCount = parseInt(document.getElementById('t-rec-count').value) || 1;
    const startDate = new Date(baseT.date);
    const startIdx = skipFirst ? 1 : 1; 

    for(let i = startIdx; i < recCount; i++) {
        let nextDate = new Date(startDate);
        if(recFreq === 'daily') nextDate.setDate(startDate.getDate() + i);
        if(recFreq === 'weekly') nextDate.setDate(startDate.getDate() + (i * 7));
        if(recFreq === 'monthly') nextDate.setMonth(startDate.getMonth() + i);
        if(recFreq === 'quarterly') nextDate.setMonth(startDate.getMonth() + (i * 3));
        if(recFreq === 'biannually') nextDate.setMonth(startDate.getMonth() + (i * 6));
        if(recFreq === 'annually') nextDate.setFullYear(startDate.getFullYear() + i);

        const dateStr = nextDate.toISOString().split('T')[0];
        const isFuture = dateStr > new Date().toISOString().split('T')[0];

        const t = { ...baseT };
        t.id = Date.now() + i;
        t.date = dateStr;
        t.checked = !isFuture;
        t.desc = baseT.desc + ` (${i+1}/${recCount})`;
        
        data.transactions.push(t);
    }
}

function editTransaction(id) {
    const t = data.transactions.find(x => x.id === id); if(!t) return;
    editModeId = id;
    openTransactionModal();
    document.getElementById('t-date').value = t.date;
    document.getElementById('t-desc').value = t.desc;
    document.getElementById('t-amount').value = Math.abs(t.amount);
    document.getElementById('t-type').value = t.type;
    if(t.category) document.getElementById('t-category').value = t.category;
    if(t.meta && t.type === 'credit_payment') {
        document.getElementById('t-principal').value = t.meta.principal || '';
        document.getElementById('t-interest').value = t.meta.interest || '';
    }
    
    document.getElementById('t-is-recurring').checked = !!t.seriesId;
    toggleRecurrenceOptions();
    updateFormUI(); updateSelects();
    
    if (t.accountId) {
        if (t.type === 'credit_payment') document.getElementById('t-credit-account').value = t.accountId;
        else if (t.type === 'income') document.getElementById('t-income-source').value = t.accountId;
        else if (t.type.includes('savings')) document.getElementById('t-savings-account').value = t.accountId;
    }
}
function cancelEdit() { editModeId = null; if(form) form.reset(); }

// --- DAY MODAL ---
function openDayModal(dateStr) {
    const modal = document.getElementById('day-modal');
    const list = document.getElementById('day-transactions-list');
    const title = document.getElementById('day-modal-title');
    if(!modal || !list) return;
    const cur = data.currency || 'RON';
    title.innerText = `Tranzacții: ${dateStr}`;
    list.innerHTML = '';
    const dayTxs = data.transactions.filter(t => t.date === dateStr);
    if(dayTxs.length === 0) {
        list.innerHTML = '<p class="text-muted text-center">Nicio tranzacție în această zi.</p>';
    } else {
        dayTxs.forEach(t => {
            let color = t.type === 'income' ? 'text-green' : 'text-red';
            list.innerHTML += `
                <div class="card" style="padding:10px; margin-bottom:0; display:flex; justify-content:space-between; align-items:center;">
                    <div><div class="font-bold">${t.desc}</div><small class="text-muted">${t.category || t.type}</small></div>
                    <div class="font-bold ${color}">${t.amount.toFixed(2)} ${cur}</div>
                </div>
            `;
        });
    }
    modal.style.display = 'flex';
}
function closeDayModal() { document.getElementById('day-modal').style.display = 'none'; }

// --- SETTINGS ---
function initSettings() {
    renderSettingsCategories();
    const curSelect = document.getElementById('app-currency');
    if(curSelect) {
        curSelect.value = data.currency || 'RON';
        curSelect.onchange = () => {
            showConfirm(`Atenție! Această acțiune va schimba doar simbolul valutei afișat, nu va converti sumele existente. Ești sigur?`, () => {
                data.currency = curSelect.value;
                saveData();
                showToast('Valută actualizată!', 'success');
                setTimeout(() => location.reload(), 1000);
            }, () => { curSelect.value = data.currency || 'RON'; });
        };
    }
}

function renderSettingsCategories() {
    const list = document.getElementById('categories-list');
    if(!list) return;
    list.innerHTML = '';
    data.categories.forEach(cat => {
        list.innerHTML += `
            <div class="flex-between" style="padding:10px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid var(--border);">
                <span>${cat}</span>
                <button class="btn-icon del" onclick="removeCategory('${cat}')"><i class="fas fa-trash"></i></button>
            </div>
        `;
    });
}

function addNewCategory() {
    const input = document.getElementById('new-cat-name');
    const val = input.value.trim();
    if(val && !data.categories.includes(val)) {
        data.categories.push(val);
        saveData();
        renderSettingsCategories();
        input.value = '';
        showToast('Categorie adăugată', 'success');
    } else {
        showToast('Nume invalid sau existent', 'warning');
    }
}

function removeCategory(cat) {
    showConfirm(`Ștergi categoria "${cat}"?`, () => {
         data.categories = data.categories.filter(c => c !== cat);
         saveData();
         renderSettingsCategories();
    });
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
}
function exportData() {
    const a = document.createElement('a'); a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data));
    a.download = "backup.json"; document.body.appendChild(a); a.click(); a.remove();
}

function exportToExcel() {
    if(!data.transactions.length) { showToast('Nu există date de exportat.', 'warning'); return; }
    const rows = data.transactions.map(t => ({
        Data: t.date,
        Descriere: t.desc,
        Tip: t.type === 'expense' ? 'Cheltuială' : (t.type === 'income' ? 'Venit' : 'Transfer'),
        Categorie: t.category || '-',
        Suma: t.amount,
        Principal: t.meta && t.meta.principal ? t.meta.principal : 0,
        Dobanda: t.meta && t.meta.interest ? t.meta.interest : 0
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tranzactii");
    XLSX.writeFile(wb, "Buget_Export.xlsx");
}

function exportToPDF() {
    if(!data.transactions.length) { showToast('Nu există date de exportat.', 'warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const rows = data.transactions.map(t => [
        t.date,
        t.desc,
        t.type === 'expense' ? 'Cheltuială' : (t.type === 'income' ? 'Venit' : 'Transfer'),
        t.amount.toFixed(2)
    ]);
    doc.text("Raport Tranzacții", 14, 15);
    doc.autoTable({
        head: [['Data', 'Descriere', 'Tip', 'Suma']],
        body: rows,
        startY: 20
    });
    doc.save('raport_tranzactii.pdf');
}

function triggerImport() { document.getElementById('backup-file-input').click(); }

function importData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            showConfirm('Atenție! Această acțiune va înlocui toate datele curente cu cele din fișier. Continui?', () => {
                data = imported;
                saveData();
                showToast('Datele au fost restaurate cu succes!', 'success');
                location.reload();
            });
        } catch (err) {
            showToast('Fișier invalid sau corupt.', 'error');
        }
    };
    reader.readAsText(file);
    input.value = '';
}

function openProfileModal() {
    const modal = document.getElementById('profile-modal');
    if(modal) {
        document.getElementById('set-user').value = localStorage.getItem('budget_app_user') || '';
        document.getElementById('set-pin').value = localStorage.getItem('budget_app_pin') || '';
        document.getElementById('set-sec-q').value = localStorage.getItem('budget_app_sec_q') || '';
        document.getElementById('set-sec-a').value = localStorage.getItem('budget_app_sec_a') || '';
        modal.style.display = 'flex';
    }
}
function closeProfileModal() { document.getElementById('profile-modal').style.display = 'none'; }

function saveProfile() {
    const u = document.getElementById('set-user').value;
    const p = document.getElementById('set-pin').value;
    const q = document.getElementById('set-sec-q').value;
    const a = document.getElementById('set-sec-a').value;
    if(u) localStorage.setItem('budget_app_user', u); else localStorage.removeItem('budget_app_user');
    if(p) localStorage.setItem('budget_app_pin', p); else localStorage.removeItem('budget_app_pin');
    if(q) localStorage.setItem('budget_app_sec_q', q); else localStorage.removeItem('budget_app_sec_q');
    if(a) localStorage.setItem('budget_app_sec_a', a); else localStorage.removeItem('budget_app_sec_a');
    closeProfileModal();
    showToast('Profil actualizat!', 'success');
}

function verifyLogin() {
    const enteredPin = document.getElementById('login-pin').value;
    const storedPin = localStorage.getItem('budget_app_pin');
    if(enteredPin === storedPin) {
        document.getElementById('login-overlay').style.display = 'none';
        sessionStorage.setItem('pin_verified', 'true');
    } else showToast('PIN Incorect', 'error');
}

function showRecovery() {
    const q = localStorage.getItem('budget_app_sec_q');
    if(!q) { showToast('Nu ai setat o întrebare de securitate.', 'warning'); return; }
    document.getElementById('login-form-section').style.display = 'none';
    document.getElementById('recovery-form-section').style.display = 'block';
    document.getElementById('rec-question').innerText = q;
}

function hideRecovery() {
    document.getElementById('login-form-section').style.display = 'block';
    document.getElementById('recovery-form-section').style.display = 'none';
}

function verifyRecovery() {
    const input = document.getElementById('rec-answer').value;
    const correct = localStorage.getItem('budget_app_sec_a');
    if(input === correct) {
        showToast('PIN-ul a fost eliminat.', 'success');
        localStorage.removeItem('budget_app_pin');
        setTimeout(() => location.reload(), 1000);
    } else {
        showToast('Răspuns incorect.', 'error');
    }
}

// --- SOUND ENGINE ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSfx(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (type === 'hover') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now); osc.stop(now + 0.05);
    } else if (type === 'click') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    }
}
function initSoundEffects() {
    document.body.addEventListener('mouseover', (e) => {
        if(e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'A') playSfx('hover');
    });
    document.body.addEventListener('click', (e) => {
        if(e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'A') playSfx('click');
    });
}

// --- NOTIFICATIONS ---
function initNotifications() {
    const toastCont = document.createElement('div');
    toastCont.id = 'toast-container';
    document.body.appendChild(toastCont);

    const confirmModal = document.createElement('div');
    confirmModal.id = 'confirm-modal';
    confirmModal.className = 'modal-overlay';
    confirmModal.style.display = 'none';
    confirmModal.style.zIndex = '10001';
    confirmModal.innerHTML = `
        <div class="modal-content text-center" style="max-width:300px;">
            <div class="mb-15"><i class="fas fa-question-circle" style="font-size:3rem; color:var(--primary);"></i></div>
            <h3 class="mb-15" style="justify-content:center; border:none;">Confirmare</h3>
            <p id="confirm-msg" class="mb-20 text-muted">Ești sigur?</p>
            <div class="flex-between gap-10">
                <button class="btn-backup w-100" id="btn-confirm-no">Nu</button>
                <button class="btn-add w-100" id="btn-confirm-yes">Da</button>
            </div>
        </div>`;
    document.body.appendChild(confirmModal);
}

function showToast(msg, type = 'info') {
    const cont = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'fa-info-circle';
    if(type==='success') icon='fa-check-circle';
    if(type==='error') icon='fa-exclamation-circle';
    if(type==='warning') icon='fa-exclamation-triangle';
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${msg}</span>`;
    cont.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s forwards';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function showConfirm(msg, onYes, onNo) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-msg').innerText = msg;
    modal.style.display = 'flex';
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-no');
    const newYes = btnYes.cloneNode(true);
    const newNo = btnNo.cloneNode(true);
    btnYes.parentNode.replaceChild(newYes, btnYes);
    btnNo.parentNode.replaceChild(newNo, btnNo);
    newYes.addEventListener('click', () => { modal.style.display = 'none'; if(onYes) onYes(); });
    newNo.addEventListener('click', () => { modal.style.display = 'none'; if(onNo) onNo(); });
}

function showRecurringDeletePrompt(onOne, onSeries) {
    let modal = document.getElementById('rec-del-modal');
    if(!modal) {
        modal = document.createElement('div');
        modal.id = 'rec-del-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '10002';
        modal.innerHTML = `
            <div class="modal-content text-center" style="max-width:350px;">
                <div class="mb-15"><i class="fas fa-sync-alt" style="font-size:3rem; color:var(--primary);"></i></div>
                <h3 class="mb-15" style="justify-content:center; border:none;">Tranzacție Recurentă</h3>
                <p class="mb-20 text-muted">Cum dorești să ștergi?</p>
                <div class="flex-col gap-10">
                    <button class="btn-add w-100" id="btn-del-one">Doar Aceasta</button>
                    <button class="btn-add w-100" id="btn-del-series" style="background:var(--orange); border-color:var(--orange);">Aceasta și Viitoarele</button>
                    <button class="btn-backup w-100" id="btn-del-cancel">Anulează</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    const btnOne = document.getElementById('btn-del-one');
    const btnSeries = document.getElementById('btn-del-series');
    const btnCancel = document.getElementById('btn-del-cancel');
    const nOne = btnOne.cloneNode(true); const nSeries = btnSeries.cloneNode(true); const nCancel = btnCancel.cloneNode(true);
    btnOne.parentNode.replaceChild(nOne, btnOne); btnSeries.parentNode.replaceChild(nSeries, btnSeries); btnCancel.parentNode.replaceChild(nCancel, btnCancel);
    nOne.addEventListener('click', () => { modal.style.display = 'none'; onOne(); });
    nSeries.addEventListener('click', () => { modal.style.display = 'none'; onSeries(); });
    nCancel.addEventListener('click', () => { modal.style.display = 'none'; });
}

function showRecurringEditPrompt(onOne, onSeries) {
    let modal = document.getElementById('rec-edit-modal');
    if(!modal) {
        modal = document.createElement('div');
        modal.id = 'rec-edit-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '10002';
        modal.innerHTML = `
            <div class="modal-content text-center" style="max-width:350px;">
                <div class="mb-15"><i class="fas fa-edit" style="font-size:3rem; color:var(--primary);"></i></div>
                <h3 class="mb-15" style="justify-content:center; border:none;">Editare Serie</h3>
                <p class="mb-20 text-muted">Cum dorești să aplici modificarea?</p>
                <div class="flex-col gap-10">
                    <button class="btn-add w-100" id="btn-edit-one">Doar Aceasta</button>
                    <button class="btn-add w-100" id="btn-edit-series" style="background:var(--orange); border-color:var(--orange);">Aceasta și Viitoarele</button>
                    <button class="btn-backup w-100" id="btn-edit-cancel">Anulează</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    const btnOne = document.getElementById('btn-edit-one');
    const btnSeries = document.getElementById('btn-edit-series');
    const btnCancel = document.getElementById('btn-edit-cancel');
    const nOne = btnOne.cloneNode(true); const nSeries = btnSeries.cloneNode(true); const nCancel = btnCancel.cloneNode(true);
    btnOne.parentNode.replaceChild(nOne, btnOne); btnSeries.parentNode.replaceChild(nSeries, btnSeries); btnCancel.parentNode.replaceChild(nCancel, btnCancel);
    nOne.addEventListener('click', () => { modal.style.display = 'none'; onOne(); });
    nSeries.addEventListener('click', () => { modal.style.display = 'none'; onSeries(); });
    nCancel.addEventListener('click', () => { modal.style.display = 'none'; });
}

function setupCategoryCombobox() {
    const inputs = document.querySelectorAll('#t-category');
    inputs.forEach(input => {
        const dropdown = input.nextElementSibling;
        if (!dropdown || !dropdown.classList.contains('custom-dropdown')) return;
        const populate = () => {
            const val = input.value.toLowerCase();
            dropdown.innerHTML = '';
            const filtered = data.categories.filter(c => c.toLowerCase().includes(val));
            if (filtered.length > 0) {
                filtered.forEach(cat => {
                    const div = document.createElement('div');
                    div.className = 'dropdown-item';
                    div.innerText = cat;
                    div.onclick = () => { input.value = cat; dropdown.style.display = 'none'; };
                    dropdown.appendChild(div);
                });
                dropdown.style.display = 'block';
            } else { dropdown.style.display = 'none'; }
        };
        input.oninput = populate;
        input.onfocus = populate;
    });
    document.addEventListener('click', (e) => {
        inputs.forEach(input => {
            const dropdown = input.nextElementSibling;
            if (dropdown && !input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
        });
    });
}
