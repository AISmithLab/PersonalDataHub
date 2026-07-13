function renderSmsTab() {
      var sms = state.sms;
      var boxBtnStyle = function(b) {
        return 'padding:6px 14px;border-radius:6px;border:1px solid;font-size:13px;cursor:pointer;' +
          (sms.box === b
            ? 'background:var(--primary);color:#fff;border-color:var(--primary);'
            : 'background:none;color:var(--muted);border-color:var(--border);');
      };

      var listHtml = '';
      if (sms.loading) {
        listHtml = '<div style="padding:40px;text-align:center"><div class="spinner"></div><p style="margin-top:12px;color:var(--muted);font-size:14px">Loading messages…</p></div>';
      } else if (sms.error) {
        if (sms.error === 'PERMISSION_DENIED') {
          listHtml = '<div style="padding:32px;text-align:center">' +
            '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.5" style="margin-bottom:12px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>' +
            '<p style="font-size:15px;font-weight:600;margin-bottom:6px">SMS Permission Required</p>' +
            '<p style="font-size:13px;color:var(--muted);margin-bottom:16px">Grant SMS permission in Android Settings to read messages.</p>' +
            '<button class="btn btn-primary" onclick="loadSmsMessages(true)">Request Permission</button>' +
            '</div>';
        } else if (sms.error === 'NOT_ANDROID') {
          listHtml = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:14px">SMS reading is only available on Android.</div>';
        } else {
          listHtml = '<div style="padding:24px"><div class="status disconnected" style="font-size:13px">Error: ' + escapeHtml(sms.error) + '</div>' +
            '<button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="loadSmsMessages(true)">Retry</button></div>';
        }
      } else if (!sms.messages) {
        listHtml = '<div style="padding:40px;text-align:center"><div class="spinner"></div></div>';
      } else if (sms.messages.length === 0) {
        listHtml = '<div style="padding:32px;text-align:center;color:var(--muted);font-size:14px">No messages in ' + sms.box + '.</div>';
      } else {
        sms.messages.forEach(function(msg) {
          var date = new Date(msg.date);
          var now = new Date();
          var diffMs = now - date;
          var diffH = diffMs / 3600000;
          var dateStr = diffH < 1 ? Math.round(diffMs / 60000) + 'm ago'
            : diffH < 24 ? Math.round(diffH) + 'h ago'
            : diffH < 48 ? 'Yesterday'
            : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          var unread = !msg.read;
          var body = msg.body || '';
          var snippet = body.length > 80 ? body.substring(0, 80) + '…' : body;
          listHtml += '<div class="email-row" data-address="' + escapeAttr(msg.address || '') + '" data-body="' + escapeAttr(body) + '" ontouchstart="smsLongPressStart(this)" ontouchend="smsLongPressEnd()" ontouchmove="smsLongPressEnd()" style="user-select:none;-webkit-user-select:none">' +
            '<div class="email-row-btn" style="display:flex;align-items:flex-start;gap:10px">' +
            (unread ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--primary);flex-shrink:0;margin-top:5px"></div>' : '<div style="width:6px;flex-shrink:0"></div>') +
            '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
            '<span class="email-row-sender">' + escapeHtml(formatContact(msg.address) || 'Unknown') + '</span>' +
            '<span class="email-row-date">' + escapeHtml(dateStr) + '</span>' +
            '</div>' +
            '<div class="email-row-snippet">' + escapeHtml(snippet) + '</div>' +
            '</div></div></div>';
        });
      }

      var cm = sms.contextMenu;
      var cmHtml = '';
      if (cm) {
        var statusHtml = '';
        if (cm.status === 'thinking') {
          statusHtml = '<div style="display:flex;align-items:center;gap:10px;padding:14px 0;color:var(--muted);font-size:14px"><div class="spinner"></div>Generating reply…</div>';
        } else if (cm.status === 'sending') {
          statusHtml = '<div style="padding:14px 0;font-size:14px"><div style="color:var(--muted);font-size:12px;margin-bottom:6px">Sending:</div><div style="font-style:italic">"' + escapeHtml(cm.reply || '') + '"</div></div>';
        } else if (cm.status === 'sent') {
          statusHtml = '<div style="padding:14px 0;color:var(--success,#22c55e);font-size:14px">✓ Reply sent</div>';
        } else if (cm.status === 'error') {
          statusHtml = '<div style="padding:14px 0;color:var(--danger,#ef4444);font-size:13px">' + escapeHtml(cm.error || 'Error') + '</div>';
        }
        var isDone = cm.status === 'sent' || cm.status === 'error';
        cmHtml = '<div style="position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end" onclick="hideSmsContextMenu()">' +
          '<div style="width:100%;background:var(--card-bg);border-radius:20px 20px 0 0;padding:20px;padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))" onclick="event.stopPropagation()">' +
          '<div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 16px"></div>' +
          '<div style="font-weight:600;font-size:15px;margin-bottom:2px">' + escapeHtml(cm.address) + '</div>' +
          '<div style="font-size:13px;color:var(--muted);margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml((cm.body || '').slice(0, 60)) + '</div>' +
          statusHtml +
          (!cm.status || cm.status === 'error' ? '<button class="btn btn-primary" style="width:100%;margin-bottom:10px" onclick="manualAutoReply()">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
            'Reply automatically</button>' : '') +
          (isDone ? '<button class="btn btn-outline" style="width:100%" onclick="hideSmsContextMenu()">Close</button>' :
            '<button class="btn btn-outline" style="width:100%" onclick="hideSmsContextMenu()">Cancel</button>') +
          '</div></div>';
      }

      return `
        <div class="card" style="padding:0;overflow:hidden">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.63 3.4 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/></svg>
              <h2 style="margin:0">SMS Messages</h2>
              ${sms.messages ? '<span style="font-size:13px;color:var(--muted)">(' + sms.messages.length + ')</span>' : ''}
            </div>
            <button class="btn btn-outline btn-sm" onclick="loadSmsMessages(true)">Refresh</button>
          </div>
          <div style="display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid var(--border)">
            <button style="${boxBtnStyle('inbox')}" onclick="state.sms.box='inbox';loadSmsMessages(true)">Inbox</button>
            <button style="${boxBtnStyle('sent')}" onclick="state.sms.box='sent';loadSmsMessages(true)">Sent</button>
            <button style="${boxBtnStyle('all')}" onclick="state.sms.box='all';loadSmsMessages(true)">All</button>
          </div>
          ${listHtml}
        </div>
        ${cmHtml}
      `;
    }