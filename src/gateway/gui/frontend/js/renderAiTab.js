function renderAiTab() {
      var chat = state.chat;
      if (!chat.aiAvailable) {
        return '<div class="flex-grow flex flex-col items-center justify-center p-xl text-center max-w-md mx-auto">' +
          '<div class="w-20 h-20 bg-surface-container-low rounded-xl flex items-center justify-center mb-md border border-outline-variant">' +
          '<span class="material-symbols-outlined text-primary text-4xl">smart_toy</span>' +
          '</div>' +
          '<h3 class="font-headline-md text-headline-md text-on-surface mb-xs">AI Assistant not configured</h3>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant mb-lg">Add an API key in Settings to get started.</p>' +
          '<button class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-xl transition-all active:scale-95 shadow-sm" onclick="switchTab(\'settings\')">Go to Settings</button>' +
          '</div>';
      }

      // Build pending SMS staged actions for this chat session
      var smsPending = state.staging.filter(function(a) {
        return a.source === 'sms' && a.status === 'pending';
      });

      var messagesHtml = '';
      if (!chat.messages.length) {
        messagesHtml = '<div class="flex-grow flex flex-col items-center justify-center max-w-2xl mx-auto text-center px-margin py-xl">' +
          '<div class="w-20 h-20 bg-surface-container-low rounded-xl flex items-center justify-center mb-md border border-outline-variant">' +
          '<span class="material-symbols-outlined text-primary text-4xl">database</span>' +
          '</div>' +
          '<h2 class="font-headline-md text-headline-md text-on-surface mb-xs">How can I help with your data?</h2>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm">Ask me anything about your data — emails, calendar, GitHub, or SMS.</p>';
          var chips = [];
          var hasPhoto = (state.sources || []).some(function(s) { return s.name === 'photo'; }) || window.AndroidSms;
          if (hasPhoto) {
            chips.push({ icon: 'image', title: 'Find photos', subtitle: 'This week', query: 'Find my recent photos from this week and summarize them' });
            chips.push({ icon: 'receipt_long', title: 'Find receipts', subtitle: 'Screenshots', query: 'Find photo screenshots of receipts and catalog them' });
          }
          var hasGmail = (state.sources || []).some(function(s) { return s.name === 'gmail' && s.connected; });
          if (hasGmail) {
            chips.push({ icon: 'mail', title: 'Summarize emails', subtitle: 'Unread 24h', query: 'Summarize my unread emails from the last 24 hours' });
            chips.push({ icon: 'edit_square', title: 'Draft reply', subtitle: 'Latest email', query: 'Draft a quick reply to the latest email I received' });
          }
          var hasSms = (state.sources || []).some(function(s) { return s.name === 'sms'; }) || window.AndroidSms;
          if (hasSms) {
            chips.push({ icon: 'sms', title: 'Find SMS codes', subtitle: 'Recent 2FA', query: 'Find my recent 2FA SMS verification codes' });
          }
          var hasCal = (state.sources || []).some(function(s) { return s.name === 'google_calendar' && s.connected; });
          if (hasCal) {
            chips.push({ icon: 'calendar_month', title: 'Check schedule', subtitle: 'Today & tomorrow', query: 'What is on my schedule for today and tomorrow?' });
          }
          var hasGh = (state.sources || []).some(function(s) { return s.name === 'github' && s.connected; });
          if (hasGh) {
            chips.push({ icon: 'code', title: 'GitHub PRs', subtitle: 'Review status', query: 'List open pull requests in my repositories' });
          }
          if (!chips.length) {
            chips.push({ icon: 'mail', title: 'Summarize emails', subtitle: 'Unread 24h', query: 'Summarize my unread emails from the last 24 hours' });
            chips.push({ icon: 'calendar_month', title: 'Check schedule', subtitle: 'Upcoming events', query: 'What is my schedule for today and tomorrow?' });
          }

          var chipsHtml = '<div class="flex flex-wrap gap-sm mt-xl w-full max-w-md justify-center" id="dynamic-chat-chips">';
          chips.forEach(function(c) {
            chipsHtml += '<button onclick="injectDemoQuestion(\'' + c.query.replace(/'/g, "\\'") + '\')" class="flex flex-col items-start p-md bg-white border border-outline-variant rounded-lg hover:border-primary transition-colors text-left group shadow-sm min-w-[130px] flex-1">' +
              '<span class="material-symbols-outlined text-primary mb-base">' + c.icon + '</span>' +
              '<span class="font-label-sm text-label-sm text-on-surface font-semibold">' + escapeHtml(c.title) + '</span>' +
              '<span class="font-body-sm text-body-sm text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity">' + escapeHtml(c.subtitle) + '</span>' +
              '</button>';
          });
          chipsHtml += '</div>';
          messagesHtml += chipsHtml + '</div>';
      } else {
        messagesHtml += '<div class="space-y-md">';
        chat.messages.forEach(function(msg) {
          var isUser = msg.role === 'user';
          var bubbleContent = isUser
            ? '<span class="whitespace-pre-wrap break-words">' + escapeHtml(msg.content) + '</span>'
            : renderMessageContent(msg);
          messagesHtml += '<div class="flex ' + (isUser ? 'justify-end' : 'justify-start') + '">' +
            '<div class="' + (isUser ? 'bg-primary text-on-primary rounded-2xl rounded-tr-sm' : 'bg-white border border-outline-variant text-on-background rounded-2xl rounded-tl-sm') + ' px-4 py-2.5 max-w-[85%] shadow-sm font-body-sm text-body-sm leading-relaxed">' +
            bubbleContent + '</div></div>';
        });
        messagesHtml += '</div>';
      }

      var smsPendingHtml = '';
      if (smsPending.length) {
        smsPendingHtml += '<div class="space-y-sm mt-md">';
        smsPending.forEach(function(a) {
          var data = typeof a.action_data === 'string' ? JSON.parse(a.action_data) : a.action_data;
          var safeId = a.action_id.replace(/'/g, "\\'");
          var safeTo = (data.to || '').replace(/'/g, "\\'");
          var safeBody = (data.body || '').replace(/'/g, "\\'");
          smsPendingHtml += '<div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm max-w-[85%] space-y-sm">' +
            '<div class="font-mono-label text-mono-label text-on-surface-variant uppercase tracking-wider">Staged SMS</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface"><strong>To:</strong> ' + escapeHtml(data.to || '') + '</div>' +
            '<div class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap">' + escapeHtml(data.body || '') + '</div>' +
            '<div class="flex gap-sm">' +
            '<button class="border border-error/30 text-error hover:bg-error-container/20 px-4 py-1.5 rounded-lg font-label-caps text-label-caps transition-all active:scale-95" onclick="rejectSmsAction(\'' + safeId + '\')">Deny</button>' +
            '<button class="bg-primary hover:bg-primary-hover text-on-primary px-4 py-1.5 rounded-lg font-label-caps text-label-caps transition-all active:scale-95 shadow-sm" onclick="sendSmsAction(\'' + safeId + '\',\'' + safeTo + '\',\'' + safeBody + '\')">Send SMS</button>' +
            '</div></div>';
        });
        smsPendingHtml += '</div>';
      }

      var loadingHtml = chat.loading
        ? '<div class="flex items-center gap-xs text-on-surface-variant/70 font-body-sm text-body-sm py-xs"><div class="spinner w-4 h-4 shrink-0"></div>Thinking…</div>'
        : '';
      var errorHtml = chat.error
        ? '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm shadow-sm mt-md">' + escapeHtml(chat.error) + '</div>'
        : '';

      var mainLayout = '<div class="flex flex-col h-full bg-background">';
      mainLayout += '  <header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      mainLayout += '    <div class="flex items-center gap-sm">';
      mainLayout += '      <span class="material-symbols-outlined text-primary">smart_toy</span>';
      mainLayout += '      <h1 class="font-headline-md text-headline-md font-bold text-primary">AI Studio</h1>';
      mainLayout += '    </div>';
      mainLayout += '    <button class="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors" onclick="clearChat()" title="Clear conversation">';
      mainLayout += '      <span class="material-symbols-outlined text-[20px]">delete</span>';
      mainLayout += '    </button>';
      mainLayout += '  </header>';
      mainLayout += '  <div id="chat-messages" class="flex-grow overflow-y-auto px-margin py-md flex flex-col justify-between">';
      mainLayout += '    <div class="flex-grow flex flex-col justify-center min-h-[70%]">';
      mainLayout += '      ' + messagesHtml;
      mainLayout += '    </div>';
      mainLayout += '    <div class="shrink-0 space-y-sm">';
      mainLayout += '      ' + smsPendingHtml;
      mainLayout += '      ' + loadingHtml;
      mainLayout += '      ' + errorHtml;
      mainLayout += '    </div>';
      mainLayout += '  </div>';
      mainLayout += '  <div class="p-margin border-t border-outline-variant bg-surface shrink-0">';
      mainLayout += '    <div class="max-w-3xl mx-auto flex gap-xs items-center bg-surface-container-low border border-outline-variant rounded-xl p-xs shadow-sm">';
      mainLayout += '      <button id="voice-btn" title="Voice input" onclick="toggleVoiceInput()" class="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors">';
      mainLayout += '        <span class="material-symbols-outlined">mic</span>';
      mainLayout += '      </button>';
      mainLayout += '      <input id="chat-input" type="text" placeholder="Ask about your data..." class="flex-grow bg-transparent border-none focus:ring-0 font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/60" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendChatMessage();}" ' + (chat.loading ? 'disabled' : '') + ' />';
      mainLayout += '      <button onclick="sendChatMessage()" ' + (chat.loading ? 'disabled' : '') + ' class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-lg py-sm rounded-lg transition-all active:scale-95 flex items-center gap-xs shadow-md shrink-0">';
      mainLayout += '        <span>Send</span>';
      mainLayout += '        <span class="material-symbols-outlined text-sm">send</span>';
      mainLayout += '      </button>';
      mainLayout += '    </div>';
      mainLayout += '  </div>';
      mainLayout += '</div>';
      return mainLayout;
    }