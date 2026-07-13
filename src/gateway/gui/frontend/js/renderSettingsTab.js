function renderSettingsTab() {
      var aiConfigured = state.chat.aiAvailable;
      var activeSection = state.settingsSection || 'ai';

      var html = '<div class="flex flex-col h-full bg-background">';

      // TopBar
      html += '<header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      html += '<div class="flex items-center gap-sm">';
      html += '<span class="material-symbols-outlined text-primary">settings</span>';
      html += '<h1 class="font-headline-md text-headline-md font-bold text-primary">Settings</h1>';
      html += '</div>';
      html += '</header>';

      // Inner Layout
      html += '<div class="flex-grow flex flex-col md:flex-row overflow-hidden pb-24 md:pb-0">';

      // Settings Navigation (Sidebar on desktop, topbar scrollable strip on mobile)
      html += '<aside class="flex md:flex-col md:w-56 border-b md:border-b-0 md:border-r border-outline-variant shrink-0 bg-surface p-sm gap-xs overflow-x-auto md:overflow-x-visible md:overflow-y-auto hide-scrollbar">';
      
      var sections = [
        { key: 'ai', label: 'AI Settings', icon: 'smart_toy' },
        { key: 'sms', label: 'SMS Auto-Reply', icon: 'sms' },
        { key: 'integrations', label: 'Integrations', icon: 'extension' },
        { key: 'audit', label: 'Activity Log', icon: 'list_alt' }
      ];

      sections.forEach(function(s) {
        var isActive = activeSection === s.key;
        var btnClass = isActive 
          ? 'bg-surface-container-high text-primary font-semibold border-primary md:border-l-4 md:border-b-0 border-b-2' 
          : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface border-transparent';
        html += '<button onclick="state.settingsSection=\x27' + s.key + '\x27; render()" class="flex items-center gap-sm px-md py-2.5 rounded-lg text-body-sm font-body-sm transition-colors whitespace-nowrap outline-none border-b-2 md:border-b-0 md:border-l-4 ' + btnClass + '">';
        html += '<span class="material-symbols-outlined text-[18px] ' + (isActive ? 'text-primary' : '') + '">' + s.icon + '</span>';
        html += '<span>' + s.label + '</span>';
        html += '</button>';
      });
      html += '</aside>';

      // Settings active view content
      html += '<div class="flex-grow p-margin overflow-y-auto max-w-4xl w-full mx-auto">';

      if (activeSection === 'ai') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">AI Assistant</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Connect any OpenAI-compatible AI provider.</p>';
        html += '  </div>';

        html += '  <div class="space-y-md max-w-md">';
        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Provider</label>';
        html += '      <div id="provider-pills" class="flex flex-wrap gap-xs">' + renderProviderPills() + '</div>';
        html += '    </div>';

        var aiPlaceholder = aiConfigured ? '•••••••••••• (Configured)' : 'sk-ant-...';
        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">API Key</label>';
        html += '      <input type="password" id="ai-api-key" placeholder="' + aiPlaceholder + '" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '    </div>';

        var currentModel = state.chat.configuredModel || '';
        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Model <span class="font-normal font-body-sm text-on-surface-variant/75">(optional — uses provider default if blank)</span></label>';
        html += '      <input type="text" id="ai-model" value="' + escapeAttr(currentModel) + '" placeholder="claude-sonnet-4-6" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '    </div>';

        html += '    <div class="space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Base URL <span class="font-normal font-body-sm text-on-surface-variant/75">(optional — uses provider default if blank)</span></label>';
        html += '      <input type="text" id="ai-base-url" placeholder="https://api.anthropic.com/v1" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '    </div>';

        html += '    <div class="flex items-center gap-md pt-sm">';
        html += '      <button onclick="saveAiKey()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-xl transition-all active:scale-95 shadow-md">Save Configuration</button>';
        html += '      <span id="ai-flash" class="text-success font-mono-label text-mono-label opacity-0">Saved</span>';
        html += '      <div class="flex items-center gap-xs">';
        html += '        <span class="status-dot ' + (aiConfigured ? 'status-dot-connected' : 'status-dot-disconnected') + '"></span>';
        html += '        <span class="font-label-sm text-label-sm ' + (aiConfigured ? 'text-primary font-semibold' : 'text-on-surface-variant') + '">' + (aiConfigured ? 'Connected' : 'Not configured') + '</span>';
        html += '      </div>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      }

      else if (activeSection === 'sms') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">SMS Auto-Reply</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">AI automatically replies to incoming SMS while the app is running.</p>';
        html += '  </div>';

        html += '  <div class="space-y-md max-w-xl">';
        html += '    <div class="flex items-center gap-sm bg-white border border-outline-variant rounded-xl p-md shadow-sm">';
        html += '      <label class="relative inline-block w-12 h-6 shrink-0 cursor-' + (state.autoReply.loading ? 'wait' : 'pointer') + '">';
        html += '        <input type="checkbox" ' + (state.autoReply.enabled ? 'checked' : '') + ' onchange="setAutoReply(this.checked)" ' + (state.autoReply.loading ? 'disabled' : '') + ' class="sr-only peer">';
        html += '        <span class="absolute inset-0 bg-secondary rounded-full transition-colors peer-checked:bg-primary"></span>';
        html += '        <span class="absolute left-[2px] top-[2px] w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-6 shadow-sm"></span>';
        html += '      </label>';
        html += '      <div class="flex flex-col gap-base">';
        html += '        <span class="font-body-md text-body-md font-semibold text-on-surface">' + (state.autoReply.enabled ? 'Enabled' : 'Disabled') + '</span>';
        html += '        <span class="font-body-sm text-body-sm text-on-surface-variant">Automatically handle incoming SMS notifications</span>';
        html += '      </div>';
        html += '    </div>';

        if (state.autoReply.enabled) {
          html += '    <div class="p-md bg-surface-container border border-outline-variant rounded-xl font-body-sm text-body-sm text-on-surface-variant space-y-xs shadow-sm">';
          html += '      <div class="flex gap-xs items-center font-semibold text-primary"><span class="material-symbols-outlined text-[18px]">info</span><span>Behavior Note</span></div>';
          html += '      <p>Replies within ~5 seconds while the app is running. Checks SMS history, Calendar, and Gmail before replying. Short codes (e.g., 2FA codes) are automatically skipped. Check the Audit Log for history.</p>';
          html += '    </div>';
        }

        if (!state.chat.aiAvailable && state.autoReply.enabled) {
          html += '    <div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm flex gap-xs items-center shadow-sm">';
          html += '      <span class="material-symbols-outlined text-[18px]">warning</span>';
          html += '      <span>AI key required — please configure a provider and key above first.</span>';
          html += '    </div>';
        }

        html += '    <div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm space-y-xs">';
        html += '      <label class="font-label-caps text-label-caps text-on-surface-variant">Context Depth (Tool Rounds)</label>';
        html += '      <div class="flex items-center gap-md">';
        html += '        <input type="number" min="1" max="10" value="' + state.autoReply.maxToolRounds + '" onchange="saveMaxToolRounds(this.value)" class="w-16 bg-white border border-outline-variant rounded-lg px-2 py-1.5 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '        <span class="font-body-sm text-body-sm text-on-surface-variant">(1 = fast, 3 = balanced, 5+ = thorough)</span>';
        html += '      </div>';
        html += '    </div>';

        html += '    <div class="flex items-center gap-md pt-sm">';
        html += '      <button onclick="testAutoReply()" ' + (state.autoReply.testLoading ? 'disabled' : '') + ' class="bg-white hover:bg-surface-container-high border border-outline text-on-surface-variant font-label-caps text-label-caps px-4 py-2.5 rounded-xl transition-all active:scale-95 shadow-sm">' + (state.autoReply.testLoading ? 'Testing...' : 'Test auto-reply') + '</button>';
        if (state.autoReply.testResult) {
          var testColorClass = state.autoReply.testResult.ok ? 'text-primary' : 'text-error';
          html += '      <span class="font-body-sm text-body-sm font-semibold ' + testColorClass + '">' + escapeHtml(state.autoReply.testResult.msg) + '</span>';
        }
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      }

      else if (activeSection === 'integrations') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">Integrations</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Connect services to give the AI access to your data.</p>';
        html += '  </div>';

        html += '  <div class="grid grid-cols-1 md:grid-cols-2 gap-md">';
        state.sources.filter(function(s) { return ['gmail','google_calendar','github'].includes(s.name); }).forEach(function(s) {
          var icons = {
            gmail: 'mail',
            google_calendar: 'calendar_month',
            github: 'code'
          };
          var labels = { gmail: 'Gmail', google_calendar: 'Google Calendar', github: 'GitHub' };
          var tabNames = { gmail: 'gmail', google_calendar: 'google_calendar', github: 'github' };
          var iconName = icons[s.name] || 'extension';
          var label = labels[s.name] || s.name;
          var accountLine = (s.accountInfo && s.accountInfo.email) ? s.accountInfo.email : 'No account details';
          
          html += '  <div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm flex flex-col justify-between gap-md">';
          html += '    <div class="flex items-start gap-sm">';
          html += '      <div class="w-10 h-10 bg-surface-container rounded-lg flex items-center justify-center border border-outline-variant shrink-0">';
          html += '        <span class="material-symbols-outlined text-primary text-[20px]">' + iconName + '</span>';
          html += '      </div>';
          html += '      <div class="min-w-0">';
          html += '        <h3 class="font-body-md text-body-md font-bold text-on-surface leading-tight">' + label + '</h3>';
          html += '        <span class="font-body-sm text-body-sm text-on-surface-variant truncate block mt-0.5">' + accountLine + '</span>';
          html += '      </div>';
          html += '    </div>';
          
          html += '    <div class="flex items-center justify-between border-t border-outline-variant/60 pt-sm">';
          html += '      <div class="flex items-center gap-xs">';
          html += '        <span class="status-dot ' + (s.connected ? 'status-dot-connected' : 'status-dot-disconnected') + '"></span>';
          html += '        <span class="font-label-sm text-label-sm ' + (s.connected ? 'text-primary font-semibold' : 'text-on-surface-variant') + '">' + (s.connected ? 'Connected' : 'Disconnected') + '</span>';
          html += '      </div>';
          
          if (s.connected) {
            html += '    <button onclick="switchTab(\x27' + tabNames[s.name] + '\x27)" class="border border-outline hover:bg-surface-container-high text-on-surface-variant font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 flex items-center gap-xs"><span>Manage</span><span class="material-symbols-outlined text-sm">arrow_forward</span></button>';
          } else {
            html += '    <a href="/oauth/' + s.name + '/start" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 text-center shadow-sm">Connect</a>';
          }
          html += '    </div>';
          html += '  </div>';
        });
        html += '  </div>';
        html += '</div>';
      }

      else if (activeSection === 'audit') {
        html += '<div class="space-y-lg">';
        html += '  <div class="border-b border-outline-variant pb-xs">';
        html += '    <h2 class="font-headline-lg text-headline-lg text-on-surface">Activity Log</h2>';
        html += '    <p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Inspect interactions, actions performed, and AI context evaluations.</p>';
        html += '  </div>';

        if (state.audit.length) {
          html += '  <div class="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">';
          html += '    <div class="overflow-x-auto">';
          html += '      <table class="w-full border-collapse text-left text-body-sm font-body-sm">';
          html += '        <thead>';
          html += '          <tr class="bg-surface-container border-b border-outline-variant">';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Time</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Event</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Source</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Details</th>';
          html += '            <th class="px-md py-3 font-semibold text-on-surface-variant uppercase text-xs tracking-wider">Response</th>';
          html += '          </tr>';
          html += '        </thead>';
          html += '        <tbody class="divide-y divide-outline-variant/60">';
          
          state.audit.forEach(function(e) {
            var d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
            var resp = d.responseSummary || '';
            var detailsCopy = Object.assign({}, d);
            delete detailsCopy.responseSummary;
            
            var respCell = resp
              ? '<details class="text-body-sm max-w-md cursor-pointer outline-none"><summary class="overflow-hidden text-ellipsis whitespace-nowrap max-w-[280px] text-primary hover:underline font-semibold focus:outline-none">' + formatResponsePreview(resp) + '</summary><div class="mt-base bg-surface-container-low p-2 rounded-lg text-body-sm font-mono-label">' + formatResponseDetails(resp) + '</div></details>'
              : '<span class="text-on-surface-variant/50">-</span>';
              
            html += '      <tr class="hover:bg-surface-container-lowest transition-colors">';
            html += '        <td class="px-md py-3 whitespace-nowrap font-mono-label text-on-surface-variant">' + new Date(e.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</td>';
            html += '        <td class="px-md py-3 whitespace-nowrap font-semibold text-on-surface">' + escapeHtml(e.event) + '</td>';
            html += '        <td class="px-md py-3 whitespace-nowrap"><span class="font-mono-label text-mono-label bg-surface-container px-xs py-0.5 rounded uppercase">' + escapeHtml(e.source || '-') + '</span></td>';
            html += '        <td class="px-md py-3 max-w-[250px] truncate font-mono-label text-[11px] text-on-surface-variant" title="' + escapeAttr(JSON.stringify(detailsCopy)) + '">' + escapeHtml(JSON.stringify(detailsCopy).slice(0, 120)) + (JSON.stringify(detailsCopy).length > 120 ? '...' : '') + '</td>';
            html += '        <td class="px-md py-3">' + respCell + '</td>';
            html += '      </tr>';
          });
          
          html += '        </tbody>';
          html += '      </table>';
          html += '    </div>';
          html += '  </div>';
        } else {
          html += '  <div class="bg-surface-container-low border border-outline-variant rounded-xl p-xl flex flex-col items-center justify-center text-center min-h-[250px]">';
          html += '    <span class="material-symbols-outlined text-primary text-3xl mb-xs">list_alt</span>';
          html += '    <p class="font-body-sm text-body-sm text-on-surface-variant">No activity has been logged yet.</p>';
          html += '  </div>';
        }
        html += '</div>';
      }

      html += '</div>'; // End content area
      html += '</div>'; // End inner layout
      html += '</div>'; // End main container
      return html;
    }