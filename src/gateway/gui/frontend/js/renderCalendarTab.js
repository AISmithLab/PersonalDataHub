function renderCalendarTab() {
      var cal = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      var realStaging = state.staging.filter(function(a) { return a.source === 'google_calendar'; });
      var calStaging = realStaging;
      var pendingCount = calStaging.filter(function(a) { return a.status === 'pending'; }).length;

      var calFilters = (state.filters || []).filter(function(f) { return f.source === 'google_calendar'; });

      var calConnected = cal && cal.connected;
      var calAccount = cal && cal.accountInfo;
      var accountEmail = calAccount && calAccount.email ? calAccount.email : '';

      var events = state.realEvents || [];
      // Sort events by start date descending (most recent at top)
      var sortedEvents = events.slice().sort(function(a, b) {
        return new Date(b.start).getTime() - new Date(a.start).getTime();
      });
      var visibleEvents = sortedEvents;

      // Disconnected state
      if (!calConnected) {
        return '<div style="max-width:480px;margin:60px auto;text-align:center">' +
          '<h1 style="font-size:24px;font-weight:700;margin-bottom:8px">Calendar</h1>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:4px">Connect your Google Calendar account to control agent access to your events.</p>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:24px;opacity:0.7">Powered by OAuth &mdash; we never store your password.</p>' +
          '<button class="btn btn-primary" onclick="startOAuth(\'google_calendar\')" style="gap:8px">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
            'Connect Calendar</button></div>';
      }

      // Build event list
      var eventListHtml = '';
      visibleEvents.forEach(function(ev) {
        var safe = ev.id.replace(/'/g, "\\'");
        var dt = new Date(ev.start);
        var timeStr = dt.toLocaleDateString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });

        eventListHtml += '<div class="email-row" style="padding:12px 16px">';
        eventListHtml += '<div style="display:flex;gap:12px;width:100%">';
        eventListHtml += '<div class="email-row-vis email-row-vis-on"></div>';
        eventListHtml += '<div style="flex:1;min-width:0">';
        eventListHtml += '<div style="display:flex;align-items:center;gap:8px">';
        eventListHtml += '<span class="email-row-sender">' + escapeHtml(ev.title) + '</span>';
        eventListHtml += '<span class="email-row-date" style="margin-left:auto">' + timeStr + '</span>';
        eventListHtml += '</div>';
        if (ev.location) eventListHtml += '<div style="font-size:12px;color:var(--muted);margin-top:2px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' + escapeHtml(ev.location) + '</div>';
        if (ev.body) eventListHtml += '<div class="email-row-snippet" style="margin-top:4px">' + escapeHtml(ev.body) + '</div>';
        eventListHtml += '</div>';
        eventListHtml += '</div>';
        eventListHtml += '</div>';
      });

      // Build action cards
      var actionHtml = '';
      calStaging.forEach(function(a) {
        var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
        var isPending = a.status === 'pending';
        var safe = a.action_id.replace(/'/g, "\\'");
        var borderClass = isPending ? 'border-left:3px solid var(--warning)' : a.status === 'approved' ? 'border-left:3px solid var(--success);opacity:0.6' : 'border-left:3px solid var(--destructive);opacity:0.6';
        var statusClass = isPending ? 'pending' : a.status === 'approved' ? 'connected' : 'rejected';
        var typeLabel = a.action_type.replace('_event', '');
        var time = new Date(a.proposed_at || a.createdAt);
        var timeStr = time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

        actionHtml += '<div class="card" style="padding:16px;' + borderClass + '">';
        actionHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
        actionHtml += '<div style="display:flex;align-items:center;gap:6px">';
        actionHtml += '<span class="status ' + statusClass + '" style="font-size:14px;font-family:JetBrains Mono,monospace;text-transform:uppercase;padding:2px 8px">' + a.status + '</span>';
        actionHtml += '<span style="font-size:14px;font-family:JetBrains Mono,monospace;color:var(--muted);text-transform:uppercase">' + typeLabel + '</span>';
        actionHtml += '</div>';
        actionHtml += '<span style="font-size:14px;font-family:JetBrains Mono,monospace;color:var(--muted)">' + timeStr + '</span>';
        actionHtml += '</div>';
        if (a.purpose) actionHtml += '<p style="font-size:14px;color:var(--muted);margin-bottom:8px">' + escapeHtml(a.purpose) + '</p>';

        actionHtml += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
        actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:48px;flex-shrink:0">Event:</span><span class="font-mono" style="color:var(--fg)">' + escapeHtml(data.title || '') + '</span></div>';
        if (data.start) actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:48px;flex-shrink:0">Start:</span><span class="font-mono" style="color:var(--fg)">' + new Date(data.start).toLocaleString() + '</span></div>';
        actionHtml += '</div>';

        if (isPending) {
          actionHtml += '<div style="display:flex;align-items:center;gap:6px;margin-top:12px">';
          actionHtml += '<button class="btn btn-sm btn-outline" style="color:var(--destructive);border-color:rgba(239,68,68,0.3);gap:4px" onclick="resolveAction(\'' + safe + '\', \'reject\')">Deny</button>';
          actionHtml += '<button class="btn btn-sm" style="background:var(--success);color:#fff;gap:4px" onclick="resolveAction(\'' + safe + '\', \'approve\')">Approve</button>';
          actionHtml += '</div>';
        }
        actionHtml += '</div>';
      });
      if (!actionHtml) actionHtml = '<div class="card" style="padding:24px;text-align:center;color:var(--muted);font-size:14px">No pending actions.</div>';

      return `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:16px">
            <div>
              <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Calendar</h1>
              ${accountEmail ? '<p style="font-size:13px;color:var(--muted);margin-top:2px">' + escapeHtml(accountEmail) + '</p>' : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--destructive);border-color:rgba(239,68,68,0.3)" onclick="if(confirm('Disconnect Calendar?')){disconnectSource('google_calendar')}">Disconnect</button>
        </div>

        <div class="card" style="padding:20px;margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:14px">Quick Filters</label>
          ${renderCalendarFilterCards(calFilters)}
        </div>

        <div class="gmail-grid">
          <div class="gmail-grid-left">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <h2 style="margin:0">Agent Access Preview</h2>
            </div>
            <div class="card" style="padding:0;overflow:hidden">
              <div class="email-list-header">
                <span class="stat">Showing: <strong>${visibleEvents.length}</strong> events</span>
                ${calConnected && !state.eventsLoading ? '<button onclick="refreshCalendarEvents()" style="margin-left:auto;background:none;border:1px solid var(--border);border-radius:4px;padding:2px 10px;font-size:12px;color:var(--muted);cursor:pointer">Refresh</button>' : ''}
              </div>
              ${state.eventsLoading
                ? '<div style="padding:40px;text-align:center"><p style="color:var(--muted);font-size:14px">Loading events...</p></div>'
                : (eventListHtml || '<p class="empty" style="padding:40px">No events found.</p>')}
            </div>
          </div>

          <div class="gmail-grid-right">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <h2 style="margin:0">Agent Action Review</h2>
              ${pendingCount ? '<span class="nav-badge">' + pendingCount + '</span>' : ''}
            </div>
            ${actionHtml}
          </div>
        </div>
      `;
    }