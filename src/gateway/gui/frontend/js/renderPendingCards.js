function renderPendingCards(actions) {
      var pending = actions.filter(function(a) { return a.status === 'pending'; });
      if (!pending.length) return '<p class="empty">No pending actions.</p>';
      var html = '';

      pending.forEach(function(a) {
        var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
        var safe = a.action_id.replace(/'/g, "\\'");

        // SMS actions are executed client-side via AndroidSms
        if (a.source === 'sms' && a.action_type === 'send_sms') {
          var safeTo = (data.to || '').replace(/'/g, "\\'");
          var safeBody = (data.body || '').replace(/'/g, "\\'");
          html += '<div class="email-card" id="card-' + a.action_id + '">';
          html += '<div class="email-card-header"><span class="email-card-title">SMS to ' + escapeHtml(data.to || '') + '</span></div>';
          html += '<div class="email-card-meta"><div class="email-field"><span class="email-field-label">To</span><span>' + escapeHtml(data.to || '') + '</span></div></div>';
          html += '<div class="email-card-body"><pre class="email-body-display">' + escapeHtml(data.body || '') + '</pre></div>';
          html += '<div class="email-card-actions">';
          html += '<button class="btn btn-deny" onclick="rejectSmsAction(\'' + safe + '\')">Deny</button>';
          html += '<button class="btn btn-approve" onclick="sendSmsAction(\'' + safe + '\',\'' + safeTo + '\',\'' + safeBody + '\')">Send SMS</button>';
          html += '</div></div>';
          return;
        }

        html += '<div class="email-card" id="card-' + a.action_id + '">';
        html += '<div class="email-card-header"><span class="email-card-title">' + escapeHtml(a.purpose || data.subject || 'Untitled') + '</span></div>';
        html += '<div class="email-card-meta">';
        html += '<div class="email-field"><span class="email-field-label">To</span><span id="display-to-' + a.action_id + '">' + escapeHtml(data.to || '') + '</span><input type="text" class="email-edit-input" id="edit-to-' + a.action_id + '" value="' + escapeAttr(data.to || '') + '" style="display:none"></div>';
        html += '<div class="email-field"><span class="email-field-label">Subject</span><span id="display-subj-' + a.action_id + '">' + escapeHtml(data.subject || '') + '</span><input type="text" class="email-edit-input" id="edit-subj-' + a.action_id + '" value="' + escapeAttr(data.subject || '') + '" style="display:none"></div>';
        html += '</div>';
        html += '<div class="email-card-body"><pre class="email-body-display" id="display-body-' + a.action_id + '">' + escapeHtml(data.body || '') + '</pre><textarea class="email-body-edit" id="edit-body-' + a.action_id + '" style="display:none">' + escapeHtml(data.body || '') + '</textarea></div>';
        html += '<div class="email-card-actions">';
        html += '<button class="btn btn-edit" id="edit-btn-' + a.action_id + '" onclick="editAction(\'' + safe + '\')">Edit</button>';
        html += '<button class="btn btn-edit" id="cancel-btn-' + a.action_id + '" onclick="cancelEdit(\'' + safe + '\')" style="display:none">Cancel</button>';
        html += '<button class="btn btn-deny" onclick="resolveAction(\'' + safe + '\', \'reject\')">Deny</button>';
        html += '<button class="btn btn-approve" onclick="approveAction(\'' + safe + '\')">Approve</button>';
        html += '</div></div>';
      });

      return html;
    }