function renderGmailTab() {
      var gmail = state.sources.find(function(s) { return s.name === 'gmail'; });
      var s = state.gmail;
      var realStaging = state.staging.filter(function(a) { return a.source === 'gmail'; });
      var gmailStaging = realStaging;
      var pendingCount = gmailStaging.filter(function(a) { return a.status === 'pending'; }).length;

      var gmailFilters = (state.filters || []).filter(function(f) { return f.source === 'gmail'; });

      var gmailConnected = gmail && gmail.connected;
      var gmailAccount = gmail && gmail.accountInfo;
      var accountEmail = gmailAccount && gmailAccount.email ? gmailAccount.email : '';

      // Emails are already filtered server-side via /api/gmail/preview
      var emails = state.realEmails || DEMO_EMAILS;
      var visibleEmails = emails;

      // Disconnected state
      if (!gmailConnected) {
        return '<div style="max-width:480px;margin:60px auto;text-align:center">' +
          '<h1 style="font-size:24px;font-weight:700;margin-bottom:8px">Gmail</h1>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:4px">Connect your Gmail account to browse and control agent access to your emails.</p>' +
          '<p style="font-size:14px;color:var(--muted);margin-bottom:24px;opacity:0.7">Powered by OAuth &mdash; we never store your password.</p>' +
          '<button class="btn btn-primary" onclick="startOAuth(\'gmail\')" style="gap:8px">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
            'Connect Gmail</button></div>';
      }

      // Build email list (emails are already filtered server-side)
      var emailListHtml = '';
      visibleEmails.forEach(function(em) {
        var isExpanded = state.expandedEmail === em.id;
        var safe = em.id.replace(/'/g, "\\'");
        var dt = new Date(em.date);
        var timeStr = dt.toLocaleDateString(undefined, { month:'short', day:'numeric' });

        emailListHtml += '<div class="email-row">';
        emailListHtml += '<button class="email-row-btn" onclick="toggleEmailExpand(\'' + safe + '\')">';
        emailListHtml += '<div style="display:flex;gap:12px;width:100%">';
        emailListHtml += '<div class="email-row-vis email-row-vis-on"></div>';
        emailListHtml += '<div style="flex:1;min-width:0">';
        emailListHtml += '<div style="display:flex;align-items:center;gap:8px">';
        emailListHtml += '<span class="email-row-sender">' + escapeHtml(em.from) + '</span>';
        if (em.hasAttachment) emailListHtml += '<svg class="email-row-attach" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
        emailListHtml += '<span class="email-row-date" style="margin-left:auto">' + timeStr + '</span>';
        emailListHtml += '</div>';
        emailListHtml += '<div class="email-row-subject">' + escapeHtml(em.subject) + '</div>';
        if (em.snippet) emailListHtml += '<div class="email-row-snippet">' + escapeHtml(em.snippet) + '</div>';
        if (em.labels && em.labels.length) {
          emailListHtml += '<div class="email-row-labels">';
          em.labels.forEach(function(l) { emailListHtml += '<span class="email-label">' + escapeHtml(l) + '</span>'; });
          emailListHtml += '</div>';
        }
        emailListHtml += '</div>';
        emailListHtml += '</div></button>';

        if (isExpanded) {
          emailListHtml += '<div class="email-expand">';
          emailListHtml += '<div class="email-expand-field"><span class="field-label">From</span><span class="field-value">' + escapeHtml(em.from) + '</span></div>';
          emailListHtml += '<div class="email-expand-field"><span class="field-label">To</span><span class="field-value">' + escapeHtml(em.to) + '</span></div>';
          emailListHtml += '<div class="email-expand-field"><span class="field-label">Subject</span><span class="field-value">' + escapeHtml(em.subject) + '</span></div>';
          if (em.labels && em.labels.length) {
            emailListHtml += '<div class="email-expand-field"><span class="field-label">Labels</span><span class="field-value">' + em.labels.map(function(l) { return escapeHtml(l); }).join(', ') + '</span></div>';
          }
          if (em.hasAttachment) {
            emailListHtml += '<div class="email-expand-field"><span class="field-label">Attach.</span><span class="field-value">' + (em.attachments ? em.attachments.map(function(a) { return escapeHtml(a); }).join(', ') : 'Yes') + '</span></div>';
          }
          emailListHtml += '<div class="email-expand-body"><pre>' + escapeHtml(em.body) + '</pre></div>';
          emailListHtml += '</div>';
        }
        emailListHtml += '</div>';
      });

      // Build action cards
      var actionHtml = '';
      gmailStaging.forEach(function(a) {
        var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
        var isPending = a.status === 'pending';
        var isReviewing = state.editingAction === a.action_id;
        var safe = a.action_id.replace(/'/g, "\\'");
        var borderClass = isPending ? 'border-left:3px solid var(--warning)' : a.status === 'approved' ? 'border-left:3px solid var(--success);opacity:0.6' : 'border-left:3px solid var(--destructive);opacity:0.6';
        var statusClass = isPending ? 'pending' : a.status === 'approved' ? 'connected' : 'rejected';
        var typeLabel = a.action_type === 'reply_email' ? 'reply' : a.action_type === 'draft_email' ? 'draft' : a.action_type;
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

        // Collapsed: show To, Subj, truncated body
        if (!isReviewing) {
          actionHtml += '<div style="font-size:14px;display:flex;flex-direction:column;gap:4px">';
          actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">To:</span><span class="font-mono" style="color:var(--fg)">' + escapeHtml(data.to || '') + '</span></div>';
          actionHtml += '<div style="display:flex;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">Subj:</span><span class="font-mono" style="color:var(--fg)">' + escapeHtml(data.subject || '') + '</span></div>';
          actionHtml += '<pre class="font-mono" style="white-space:pre-wrap;background:rgba(0,0,0,0.03);border-radius:6px;padding:8px;font-size:14px;color:var(--fg);max-height:80px;overflow:hidden;margin-top:4px;cursor:pointer;position:relative" onclick="toggleEditAction(\'' + safe + '\')">' + escapeHtml(data.body || '') + '<span style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(transparent,#f5f5f5);pointer-events:none"></span></pre>';
          actionHtml += '</div>';
        }

        // Expanded: full editable view
        if (isReviewing) {
          actionHtml += '<div style="font-size:14px;display:flex;flex-direction:column;gap:6px">';
          actionHtml += '<div style="display:flex;align-items:center;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">To:</span><input type="text" class="email-edit-input" id="edit-to-' + a.action_id + '" value="' + escapeAttr(data.to || '') + '" style="font-family:JetBrains Mono,monospace;font-size:14px;padding:4px 8px"></div>';
          actionHtml += '<div style="display:flex;align-items:center;gap:8px"><span style="color:var(--muted);width:36px;flex-shrink:0">Subj:</span><input type="text" class="email-edit-input" id="edit-subj-' + a.action_id + '" value="' + escapeAttr(data.subject || '') + '" style="font-family:JetBrains Mono,monospace;font-size:14px;padding:4px 8px"></div>';
          actionHtml += '<div><span style="color:var(--muted);display:block;margin-bottom:4px">Body:</span><textarea class="email-body-edit" id="edit-body-' + a.action_id + '" style="font-family:JetBrains Mono,monospace;font-size:14px;min-height:160px">' + escapeHtml(data.body || '') + '</textarea></div>';
          actionHtml += '</div>';
        }

        // Buttons
        if (isPending) {
          actionHtml += '<div style="display:flex;align-items:center;gap:6px;margin-top:12px">';
          if (!isReviewing) {
            actionHtml += '<button class="btn btn-sm btn-outline" style="gap:4px" onclick="toggleEditAction(\'' + safe + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Review</button>';
          } else {
            actionHtml += '<button class="btn btn-sm btn-outline" style="color:var(--destructive);border-color:rgba(239,68,68,0.3);gap:4px" onclick="resolveAction(\'' + safe + '\', \'reject\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Deny</button>';
            actionHtml += '<button class="btn btn-sm" style="background:var(--primary);color:#fff;gap:4px" onclick="approveAction(\'' + safe + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Save to Draft</button>';
            actionHtml += '<button class="btn btn-sm" style="background:var(--success);color:#fff;gap:4px" onclick="sendAction(\'' + safe + '\')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send</button>';
          }
          actionHtml += '</div>';
        }
        actionHtml += '</div>';
      });
      if (!actionHtml) actionHtml = '<div class="card" style="padding:24px;text-align:center;color:var(--muted);font-size:14px">No pending actions from agents.</div>';

      return `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:16px">
            <div>
              <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Gmail</h1>
              ${accountEmail ? '<p style="font-size:13px;color:var(--muted);margin-top:2px">' + escapeHtml(accountEmail) + '</p>' : ''}
            </div>
          </div>
          <button class="btn btn-outline btn-sm" style="color:var(--destructive);border-color:rgba(239,68,68,0.3)" onclick="if(confirm('Disconnect Gmail? This will revoke all access tokens and disable Gmail access for all agents.')){disconnectSource('gmail')}">Disconnect</button>
        </div>

        <div class="card" style="padding:20px;margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px;display:block;margin-bottom:14px">Quick Filters</label>
          ${renderFilterCards(gmailFilters)}
        </div>

        <div class="gmail-grid">
          <div class="gmail-grid-left">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <h2 style="margin:0">Agent Access Preview</h2>
            </div>
            <div class="card" style="padding:0;overflow:hidden">
              <div class="email-list-header">
                <span class="stat">Showing: <strong>${visibleEmails.length}</strong> emails</span>
                ${!state.realEmails && gmailConnected && !state.emailsLoading ? '<span style="margin-left:auto;font-size:12px;color:var(--muted);opacity:0.7">Sample data</span>' : ''}
                ${state.realEmails && gmailConnected ? '<button onclick="refreshEmails()" style="margin-left:auto;background:none;border:1px solid var(--border);border-radius:4px;padding:2px 10px;font-size:12px;color:var(--muted);cursor:pointer">Refresh</button>' : ''}
              </div>
              ${state.emailsLoading
                ? '<div style="padding:40px;text-align:center"><p style="color:var(--muted);font-size:14px">Loading emails from Gmail...</p></div>'
                : state.emailsError
                  ? '<div style="padding:40px;text-align:center"><p style="color:var(--destructive);font-size:14px">Error: ' + escapeHtml(state.emailsError) + '</p><button class="btn btn-primary" onclick="refreshEmails()" style="margin-top:12px">Retry</button></div>'
                  : (emailListHtml || '<p class="empty" style="padding:40px">No emails found.</p>')}
            </div>
          </div>

          <div class="gmail-grid-right">
            <div class="action-review-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--muted)"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <h2 style="margin:0">Agent Action Review</h2>
              ${pendingCount ? '<span class="nav-badge">' + pendingCount + '</span>' : ''}
            </div>
            ${actionHtml}
          </div>
        </div>
        </div>
      `;
    }