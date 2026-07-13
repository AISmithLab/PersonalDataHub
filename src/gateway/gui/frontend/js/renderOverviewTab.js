function renderOverviewTab() {
      var gmail = state.sources.find(function(s) { return s.name === 'gmail'; });
      var github = state.sources.find(function(s) { return s.name === 'github'; });
      var cal = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      var gmailConnected = gmail && gmail.connected;
      var ghConnected = github && github.connected;
      var calConnected = cal && cal.connected;
      var gmailAccount = gmail && gmail.accountInfo;
      var ghAccount = github && github.accountInfo;
      var calAccount = cal && cal.accountInfo;
      var gmailFilters = (state.filters || []).filter(function(f) { return f.source === 'gmail'; });
      var activeFilterCount = gmailFilters.filter(function(f) { return f.enabled; }).length;
      var calFilters = (state.filters || []).filter(function(f) { return f.source === 'google_calendar'; });
      var activeCalFilterCount = calFilters.filter(function(f) { return f.enabled; }).length;
      var enabledRepos = (state.github.repoList || []).filter(function(r) { return r.enabled; }).length;
      var totalRepos = (state.github.repoList || []).length;
      var pendingCount = state.staging.filter(function(a) { return a.status === 'pending'; }).length;

      var recentHtml = '';
      if (state.audit.length) {
        recentHtml = state.audit.slice(0, 5).map(function(e) {
          var d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
          var evClass = '';
          if (e.event.indexOf('approved') !== -1 || e.event.indexOf('committed') !== -1) evClass = 'connected';
          else if (e.event.indexOf('rejected') !== -1) evClass = 'rejected';
          else if (e.event.indexOf('proposed') !== -1) evClass = 'pending';
          var time = new Date(e.timestamp);
          var timeStr = time.getHours().toString().padStart(2,'0') + ':' + time.getMinutes().toString().padStart(2,'0');
          var respLine = d.responseSummary ? '<div style="padding:2px 0 4px 52px;border-bottom:1px solid var(--border)"><details style="font-size:12px;color:var(--muted);cursor:pointer"><summary style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><em>Response:</em> ' + formatResponsePreview(d.responseSummary) + '</summary>' + formatResponseDetails(d.responseSummary) + '</details></div>' : '';
          return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;' + (respLine ? '' : 'border-bottom:1px solid var(--border);') + 'font-size:14px">' +
            '<span class="font-mono" style="font-size:14px;color:var(--muted);min-width:40px">' + timeStr + '</span>' +
            '<span class="status ' + evClass + '" style="font-size:14px">' + e.event + '</span>' +
            '<span style="flex:1;color:var(--muted);font-size:14px;overflow-wrap:break-word;word-break:break-word">' + (d.purpose || d.result || (e.source || '')) + '</span>' +
            '</div>' + respLine;
        }).join('');
      } else {
        recentHtml = '<p class="empty">No recent activity.</p>';
      }

      return `
        <div style="margin-bottom:24px">
          <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Access Control Gateway</h1>
          <p style="font-size:14px;color:var(--muted);margin-top:4px">Zero access by default. Control exactly what AI agents can see.</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px">
          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('sms')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>
                <span style="font-weight:600;font-size:15px">SMS</span>
              </div>
              <span class="status-dot status-dot-connected"></span>
            </div>
            <p style="font-size:14px;color:var(--muted);margin-bottom:8px">Messages via Android bridge</p>
            <div style="display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Open <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('gmail')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <span style="font-weight:600;font-size:15px">Email</span>
              </div>
              <span class="status-dot ${gmailConnected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
            </div>
            ${gmailConnected && gmailAccount && gmailAccount.email ? '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + gmailAccount.email + '</p>' : '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">Not connected</p>'}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:13px;color:var(--muted)">Filters: <strong class="font-mono" style="color:var(--fg)">${activeFilterCount} active</strong></span>
              ${pendingCount ? '<span class="nav-badge">' + pendingCount + ' pending</span>' : ''}
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Configure <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('google_calendar')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span style="font-weight:600;font-size:15px">Calendar</span>
              </div>
              <span class="status-dot ${calConnected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
            </div>
            ${calConnected && calAccount && calAccount.email ? '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + calAccount.email + '</p>' : '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">Not connected</p>'}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:13px;color:var(--muted)">Filters: <strong class="font-mono" style="color:var(--fg)">${activeCalFilterCount} active</strong></span>
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Configure <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('github')">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                <span style="font-weight:600;font-size:15px">GitHub</span>
              </div>
              <span class="status-dot ${ghConnected ? 'status-dot-connected' : 'status-dot-disconnected'}"></span>
            </div>
            ${ghConnected && ghAccount && ghAccount.login ? '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">@' + ghAccount.login + '</p>' : '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">Not connected</p>'}
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:13px;color:var(--muted)">Repos: <strong class="font-mono" style="color:var(--fg)">${enabledRepos} selected</strong></span>
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">Configure <span style="font-size:14px">&rarr;</span></div>
          </div>

          <div class="card source-tile" style="cursor:pointer" onclick="switchTab('settings')">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <span style="font-weight:600;font-size:15px">Audit Log</span>
            </div>
            <span style="font-size:14px;color:var(--muted)"><strong class="font-mono" style="color:var(--fg)">${state.audit.length}</strong> events recorded</span>
            <div style="margin-top:10px;display:flex;align-items:center;gap:4px;font-size:14px;color:var(--primary);font-weight:500">View log <span style="font-size:14px">&rarr;</span></div>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h2 style="margin:0">Recent Activity</h2>
            ${state.audit.length ? '<button class="btn btn-sm" style="font-size:12px;padding:4px 10px;color:var(--destructive);border-color:var(--destructive)" onclick="clearAuditLog()">Clear history</button>' : ''}
          </div>
          ${recentHtml}
        </div>
      `;
    }