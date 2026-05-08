// Nova Vacation Homes Dashboard Logic

const API_BASE = '/api/dashboard';

// -- State Management --
let currentTab = 'overview';
let callLogs = [];
let analytics = null;
let voiceConfig = null;

// -- Initialization --
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  fetchData();
  
  // Refresh data every 5 minutes
  setInterval(fetchData, 5 * 60 * 1000);
});

function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-tab');
      switchTab(target);
    });
  });
}

function switchTab(tabId) {
  currentTab = tabId;
  
  // Update UI
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-tab') === tabId);
  });
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
  
  // Fetch specific tab data if needed
  if (tabId === 'calls') fetchCalls();
  if (tabId === 'leads') fetchLeads();
  if (tabId === 'service') fetchServiceRequests();
  if (tabId === 'feedback') fetchFeedback();
  if (tabId === 'settings') fetchConfig();
}

async function fetchData() {
  await fetchAnalytics();
  if (currentTab === 'calls') await fetchCalls();
  if (currentTab === 'leads') await fetchLeads();
  if (currentTab === 'service') await fetchServiceRequests();
  if (currentTab === 'feedback') await fetchFeedback();
}

// -- API Fetching --

async function fetchAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/analytics?days=30`);
    analytics = await res.json();
    renderAnalytics();
  } catch (err) {
    console.error('Failed to fetch analytics', err);
  }
}

async function fetchCalls(page = 1) {
  try {
    const res = await fetch(`${API_BASE}/calls?page=${page}&limit=20`);
    const data = await res.json();
    callLogs = data.calls;
    renderCalls(callLogs);
  } catch (err) {
    console.error('Failed to fetch calls', err);
  }
}

async function fetchLeads() {
  try {
    const res = await fetch(`${API_BASE}/intake`);
    const data = await res.json();
    renderLeads(data.items);
  } catch (err) {
    console.error('Failed to fetch leads', err);
  }
}

async function fetchServiceRequests() {
  try {
    const res = await fetch(`${API_BASE}/service-requests`);
    const data = await res.json();
    renderServiceRequests(data.items);
  } catch (err) {
    console.error('Failed to fetch service requests', err);
  }
}

async function fetchFeedback() {
  try {
    const res = await fetch(`${API_BASE}/feedback`);
    const data = await res.json();
    renderFeedback(data.items);
  } catch (err) {
    console.error('Failed to fetch feedback', err);
  }
}

async function fetchConfig() {
  try {
    const res = await fetch(`${API_BASE}/voice-config`);
    voiceConfig = await res.json();
    renderConfig();
  } catch (err) {
    console.error('Failed to fetch config', err);
  }
}

// -- Rendering --

function renderAnalytics() {
  if (!analytics) return;
  
  const s = analytics.summary;
  document.getElementById('totalCalls').textContent = s.totalCalls;
  document.getElementById('totalBookings').textContent = s.successfulBookings;
  document.getElementById('totalEscalations').textContent = s.escalatedCalls;
  document.getElementById('convRate').textContent = (s.bookingConversionRate * 100).toFixed(1) + '%';
  
  renderDailyChart(analytics.daily);
  renderIntentChart(analytics.intents);
}

let dailyChart = null;
function renderDailyChart(dailyData) {
  const ctx = document.getElementById('dailyChart');
  if (!ctx) return;
  
  if (dailyChart) dailyChart.destroy();
  
  const labels = dailyData.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).reverse();
  const calls = dailyData.map(d => d.totalCalls).reverse();
  const bookings = dailyData.map(d => d.bookings).reverse();
  
  dailyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Calls',
          data: calls,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Bookings',
          data: bookings,
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#94a3b8' } }
      },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
      }
    }
  });
}

let intentChart = null;
function renderIntentChart(intents) {
  const ctx = document.getElementById('intentChart');
  if (!ctx) return;
  
  if (intentChart) intentChart.destroy();
  
  const labels = intents.slice(0, 5).map(i => i.intent);
  const data = intents.slice(0, 5).map(i => i.count);
  
  intentChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12 } }
      }
    }
  });
}

function renderCalls(calls) {
  const tbody = document.getElementById('callsTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = calls.map(call => `
    <tr onclick="viewTranscript('${call.call_id}')" style="cursor:pointer">
      <td>${new Date(call.created_at).toLocaleString()}</td>
      <td>${call.phone_number || 'Unknown'}</td>
      <td><span class="status-badge" style="background:rgba(255,255,255,0.05)">${call.intent || 'Unknown'}</span></td>
      <td>${formatDuration(call.duration_seconds)}</td>
      <td>
        ${call.escalated 
          ? `<span class="status-badge status-danger">Escalated</span>` 
          : `<span class="status-badge status-success">Handled</span>`}
      </td>
      <td style="color:var(--accent-light)">View Details →</td>
    </tr>
  `).join('');
}

function renderLeads(leads) {
  const tbody = document.getElementById('leadsTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = leads.map(lead => `
    <tr>
      <td>${new Date(lead.created_at).toLocaleDateString()}</td>
      <td><strong>${lead.caller_name || 'Anonymous'}</strong><br><small>${lead.caller_phone || ''}</small></td>
      <td><span class="status-badge" style="background:rgba(99,102,241,0.1)">${lead.intake_type.replace('_', ' ')}</span></td>
      <td>${lead.reason || lead.destination || '—'}</td>
      <td><span class="status-badge ${getStatusClass(lead.status)}">${lead.status}</span></td>
    </tr>
  `).join('');
}

function renderServiceRequests(requests) {
  const tbody = document.getElementById('serviceTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = requests.map(req => `
    <tr>
      <td>${new Date(req.created_at).toLocaleDateString()}</td>
      <td>Res: <strong>${req.reservation_id}</strong></td>
      <td>${req.request_type}</td>
      <td><span class="status-badge" style="background:rgba(255,255,255,0.05)">${req.urgency}</span></td>
      <td><span class="status-badge ${getStatusClass(req.status)}">${req.status}</span></td>
    </tr>
  `).join('');
}

function renderFeedback(items) {
  const tbody = document.getElementById('feedbackTableBody');
  if (!tbody) return;

  // Update counts
  const pending = items.filter(i => i.status === 'pending').length;
  const progress = items.filter(i => i.status === 'in_progress').length;
  const done = items.filter(i => i.status === 'done').length;

  document.getElementById('pendingCount').textContent = pending;
  document.getElementById('progressCount').textContent = progress;
  document.getElementById('doneCount').textContent = done;

  tbody.innerHTML = items.map(item => `
    <tr>
      <td>${new Date(item.created_at).toLocaleDateString()}</td>
      <td>
        <strong>${item.title}</strong><br>
        <small style="color:var(--text-dim)">${item.description}</small>
      </td>
      <td><span class="status-badge" style="background:rgba(255,255,255,0.05)">${item.priority}</span></td>
      <td><span class="status-badge ${getFeedbackStatusClass(item.status)}">${item.status.replace('_', ' ')}</span></td>
      <td>
        <select onchange="updateFeedbackStatus('${item.id}', this.value)" style="width: auto; padding: 4px 8px; font-size: 11px;">
          <option value="pending" ${item.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${item.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${item.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </td>
    </tr>
  `).join('');
}

function renderConfig() {
  if (!voiceConfig) return;
  
  const container = document.getElementById('configForm');
  if (!container) return;
  
  // Update specific fields if they exist
  document.getElementById('voiceEn').value = voiceConfig.voiceEn;
  document.getElementById('voiceEs').value = voiceConfig.voiceEs;
  document.getElementById('voiceSpeed').value = voiceConfig.speed;
  document.getElementById('voiceStability').value = voiceConfig.stability;
}

// -- Actions --

async function viewTranscript(callId) {
  try {
    const res = await fetch(`${API_BASE}/calls/${callId}/transcript`);
    const data = await res.json();
    
    const modal = document.getElementById('transcriptModal');
    const container = document.getElementById('transcriptContent');
    
    document.getElementById('modalTitle').textContent = `Call Details: ${callId}`;
    
    container.innerHTML = data.interactions.map(msg => {
      if (msg.role === 'system') return '';
      
      let html = `
        <div class="transcript-message">
          <div class="msg-header">
            <span>${msg.role.toUpperCase()}</span>
            <span>${new Date(msg.created_at).toLocaleTimeString()}</span>
          </div>
          <div class="msg-bubble msg-${msg.role}">
            ${msg.message}
          </div>
      `;
      
      if (msg.tool_called) {
        html += `
          <div class="msg-tool">
            <strong>Tool: ${msg.tool_called}</strong><br>
            <small>Input: ${JSON.stringify(msg.tool_params)}</small><br>
            <small>Result: ${JSON.stringify(msg.tool_result).substring(0, 200)}...</small>
          </div>
        `;
      }
      
      html += `</div>`;
      return html;
    }).join('');
    
    modal.style.display = 'flex';
  } catch (err) {
    console.error('Failed to fetch transcript', err);
  }
}

function closeModal() {
  document.getElementById('transcriptModal').style.display = 'none';
}

function showFeedbackForm() {
  document.getElementById('feedbackModal').style.display = 'flex';
}

function closeFeedbackModal() {
  document.getElementById('feedbackModal').style.display = 'none';
  document.getElementById('newFeedbackForm').reset();
}

async function submitFeedback(e) {
  e.preventDefault();
  const title = document.getElementById('fbTitle').value;
  const description = document.getElementById('fbDesc').value;
  const priority = document.getElementById('fbPriority').value;

  try {
    const res = await fetch(`${API_BASE}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, priority })
    });
    if (res.ok) {
      closeFeedbackModal();
      fetchFeedback();
    }
  } catch (err) {
    console.error('Failed to submit feedback', err);
  }
}

async function updateFeedbackStatus(id, status) {
  try {
    const res = await fetch(`${API_BASE}/feedback/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      fetchFeedback();
    }
  } catch (err) {
    console.error('Failed to update feedback status', err);
  }
}

// -- Utilities --

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function getStatusClass(status) {
  if (status === 'resolved' || status === 'completed') return 'status-success';
  if (status === 'pending') return 'status-warning';
  return '';
}

function getFeedbackStatusClass(status) {
  if (status === 'done') return 'status-success';
  if (status === 'in_progress') return 'status-warning';
  if (status === 'pending') return 'status-danger';
  return '';
}

function getUrgencyClass(urgency) {
  if (urgency === 'high' || urgency === 'emergency') return 'status-danger';
  if (urgency === 'medium') return 'status-warning';
  return 'status-success';
}
