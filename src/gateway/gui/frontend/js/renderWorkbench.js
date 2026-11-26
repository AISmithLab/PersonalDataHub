// The Skills and Pipes pages: a chat on the left for configuring, and the things
    // being configured on the right. Each page has its own conversation, and the chat is
    // told which skill or pipe is selected, so "make it stricter" changes that one.

    var PAGE_CHAT = {
      skills: { title: 'Skills', icon: 'bolt', placeholder: 'Describe how the AI should behave…', empty: 'Describe a behavior and I will turn it into a skill. Open a skill on the right to change that one.' },
      pipes: { title: 'Pipes', icon: 'filter_alt', placeholder: 'For example: only show the recommendation submission emails to the agents', empty: 'Describe a filter, for example "only show the recommendation submission emails to the agents", and I will build a pipe for it. Select a pipe on the right to change that one.' }
    };

    function pageChatFocus(scope) {
      if (scope === 'pipes') {
        var p = (state.pipes.items || []).filter(function(x) { return x.id === state.pipes.selectedId; })[0];
        return p ? { id: p.id, name: p.name } : null;
      }
      var s = (state.skills.items || []).filter(function(x) { return x.id === state.skills.editingId; })[0];
      return s ? { id: s.id, name: s.name } : null;
    }

    function renderPageChat(scope) {
      var chat = state.pageChats[scope];
      var meta = PAGE_CHAT[scope];
      var focus = pageChatFocus(scope);
      var html = '<div class="flex flex-col h-full bg-surface">';
      html += '<header class="flex justify-between items-center px-md h-16 border-b border-outline-variant shrink-0">';
      html += '<div class="flex items-center gap-sm min-w-0"><span class="material-symbols-outlined text-primary">chat</span>';
      html += '<h1 class="font-headline-md text-headline-md font-bold text-primary truncate">' + meta.title + ' chat</h1></div>';
      html += '<button class="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors" onclick="clearPageChat(\x27' + scope + '\x27)" title="Clear conversation"><span class="material-symbols-outlined text-[20px]">delete</span></button>';
      html += '</header>';

      if (!state.chat.aiAvailable) {
        html += '<div class="flex-grow flex flex-col items-center justify-center p-lg text-center">';
        html += '<span class="material-symbols-outlined text-primary text-4xl mb-sm">smart_toy</span>';
        html += '<div class="font-body-md text-body-md font-semibold text-on-surface">AI Assistant not configured</div>';
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant mt-xs mb-md">Add an API key in Settings to configure ' + meta.title.toLowerCase() + ' by chat.</p>';
        html += '<button class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-2 rounded-lg" onclick="switchTab(\x27settings\x27)">Go to Settings</button>';
        html += '</div></div>';
        return html;
      }

      html += '<div id="page-chat-messages" class="flex-grow overflow-y-auto px-md py-md space-y-md">';
      if (!chat.messages.length) {
        html += '<div class="h-full flex flex-col items-center justify-center text-center px-md">';
        html += '<span class="material-symbols-outlined text-primary text-4xl mb-sm">' + meta.icon + '</span>';
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-xs">' + escapeHtml(meta.empty) + '</p></div>';
      }
      chat.messages.forEach(function(msg) {
        var isUser = msg.role === 'user';
        var body = isUser ? '<span class="whitespace-pre-wrap break-words">' + escapeHtml(msg.content) + '</span>' : renderMessageContent(msg);
        html += '<div class="flex ' + (isUser ? 'justify-end' : 'justify-start') + '"><div class="' +
          (isUser ? 'bg-primary text-on-primary rounded-2xl rounded-tr-sm' : 'bg-white border border-outline-variant text-on-background rounded-2xl rounded-tl-sm') +
          ' px-4 py-2.5 max-w-[90%] shadow-sm font-body-sm text-body-sm leading-relaxed min-w-0 break-words">' + body + '</div></div>';
      });
      if (chat.loading) html += '<div class="flex items-center gap-xs text-on-surface-variant/70 font-body-sm text-body-sm"><div class="spinner w-4 h-4 shrink-0"></div>Thinking…</div>';
      if (chat.error) html += '<div class="p-sm bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm">' + escapeHtml(chat.error) + '</div>';
      html += '</div>';

      html += '<div class="p-sm border-t border-outline-variant shrink-0 space-y-xs">';
      // What the next message is about.
      html += '<div class="flex items-center gap-xs text-xs text-on-surface-variant px-xs min-h-[20px]">';
      if (focus) {
        html += '<span class="material-symbols-outlined text-[14px] text-primary">adjust</span><span class="truncate">' + (scope === 'pipes' ? 'Revising' : 'About') + ' <b class="text-on-surface">' + escapeHtml(focus.name) + '</b></span>';
        if (scope === 'pipes') html += '<button class="underline shrink-0" onclick="selectPipe(null)">new pipe instead</button>';
      } else {
        html += '<span class="truncate">' + (scope === 'pipes' ? 'New pipe: describe what it should release.' : 'No skill open: a message creates a new skill.') + '</span>';
      }
      html += '</div>';
      html += '<div class="flex gap-xs items-center bg-surface-container-low border border-outline-variant rounded-xl p-xs">';
      html += '<input id="page-chat-input-' + scope + '" type="text" value="' + escapeAttr(chat.draft) + '" placeholder="' + escapeAttr(meta.placeholder) + '" class="flex-grow min-w-0 bg-transparent border-none focus:ring-0 font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/60" oninput="state.pageChats.' + scope + '.draft=this.value" onkeydown="if(event.key===\x27Enter\x27&&!event.isComposing){event.preventDefault();sendPageChat(\x27' + scope + '\x27)}">';
      html += '<button onclick="sendPageChat(\x27' + scope + '\x27)" ' + (chat.loading ? 'disabled' : '') + ' class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-md py-sm rounded-lg transition-all active:scale-95 flex items-center gap-xs shadow-sm disabled:opacity-50 shrink-0"><span>Send</span><span class="material-symbols-outlined text-sm">send</span></button>';
      html += '</div></div></div>';
      return html;
    }

    // Two panels side by side on a desktop; stacked on a narrow screen.
    function renderTwoPanel(scope, rightHtml) {
      return '<div class="flex flex-col md:flex-row h-full">' +
        '<div class="md:w-[400px] lg:w-[440px] shrink-0 h-[55vh] md:h-full border-b md:border-b-0 md:border-r border-outline-variant min-h-0">' + renderPageChat(scope) + '</div>' +
        '<div class="flex-grow min-w-0 h-full min-h-0">' + rightHtml + '</div></div>';
    }

    function renderSkillPage() {
      return renderTwoPanel('skills', renderSkillTab());
    }

    function pipeRowSummary(row) {
      var d = (row && typeof row === 'object' && row.data && typeof row.data === 'object') ? row.data : (row && typeof row === 'object' ? row : {});
      var title = d.title || d.subject || d.name || d.summary || (row && row.source_item_id) || (typeof row === 'string' ? row : JSON.stringify(row).slice(0, 80));
      var who = d.author_email || d.author_name || d.from || d.organizer || '';
      var when = (row && row.timestamp) || d.date || d.start || '';
      var whenText = '';
      if (when) { var dt = new Date(when); whenText = isNaN(dt.getTime()) ? String(when) : dt.toLocaleDateString([], { month: 'short', day: 'numeric' }); }
      return { title: String(title), sub: [who, whenText].filter(Boolean).join(' · ') };
    }

    // One item in the preview lists. `mark`: true released, false held back, null unknown, undefined no mark.
    function pipeRowHtml(row, mark) {
      var s = pipeRowSummary(row);
      var held = mark === false;
      var html = '<div class="border rounded-lg px-sm py-xs flex items-center gap-sm ' + (held ? 'border-outline-variant/60 bg-surface-container-low' : 'border-outline-variant bg-white') + '">';
      if (mark === true) html += '<span class="material-symbols-outlined text-[16px] text-primary shrink-0" title="Released to agents">check_circle</span>';
      else if (mark === false) html += '<span class="material-symbols-outlined text-[16px] text-on-surface-variant/50 shrink-0" title="Held back">block</span>';
      html += '<div class="min-w-0 flex-grow"><div class="font-body-sm text-body-sm truncate ' + (held ? 'text-on-surface-variant' : 'font-semibold text-on-surface') + '">' + escapeHtml(s.title) + '</div>';
      if (s.sub) html += '<div class="text-xs text-on-surface-variant truncate">' + escapeHtml(s.sub) + '</div>';
      html += '</div></div>';
      return html;
    }

    function renderPipePage() {
      var pp = state.pipes;
      if (pp.items === null && !pp.loading) loadPipes();
      var SRC = { gmail: 'Gmail', google_calendar: 'Calendar', github: 'GitHub' };
      var EXAMPLE = 'only release the emails from the past month that contain the word "recommendation"';
      var p = (pp.items || []).filter(function(x) { return x.id === pp.selectedId; })[0];
      var html = '<div class="flex flex-col h-full bg-background">';
      html += '<header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      html += '<div class="flex items-center gap-sm"><span class="material-symbols-outlined text-primary">filter_alt</span><h1 class="font-headline-md text-headline-md font-bold text-primary">Pipes</h1></div>';
      html += '<button onclick="selectPipe(null)" class="flex items-center gap-xs font-label-caps text-label-caps px-md py-sm rounded-lg transition-colors ' + (p ? 'bg-primary hover:bg-primary-hover text-on-primary' : 'border border-primary text-primary bg-primary/5') + '"><span class="material-symbols-outlined text-[18px]">add</span>New pipe</button>';
      html += '</header>';
      html += '<div class="flex-grow overflow-y-auto px-margin py-md space-y-md pb-24">';
      html += '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-2xl">A pipe releases a filtered part of one source to agents, without giving them the source itself. Start a new pipe or select one, then describe what it should release in the chat. Each change is run on your latest data and shown here.</p>';
      if (pp.error) html += '<div class="p-sm bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm">' + escapeHtml(pp.error) + '</div>';

      if (pp.items === null) {
        html += '<div class="text-body-sm text-on-surface-variant">Loading…</div>';
      } else {
        if (pp.items.length) {
          html += '<div class="space-y-xs">';
          pp.items.forEach(function(x) {
            var sel = x.id === pp.selectedId;
            html += '<div onclick="selectPipe(\x27' + x.id + '\x27)" class="cursor-pointer border rounded-xl px-md py-sm flex items-center gap-md transition-colors ' + (sel ? 'border-primary bg-primary/5 shadow-sm' : 'border-outline-variant bg-white hover:bg-surface-container-low') + '">';
            html += '<div class="flex-grow min-w-0"><div class="font-body-md text-body-md font-semibold text-on-surface truncate">' + escapeHtml(x.name) + '</div>';
            html += '<div class="text-xs text-on-surface-variant truncate">' + escapeHtml(SRC[x.source] || x.source) + (x.description ? ' · ' + escapeHtml(x.description) : '') + '</div></div>';
            html += '<span class="text-xs font-semibold shrink-0 ' + (x.enabled ? 'text-primary' : 'text-on-surface-variant') + '">' + (x.enabled ? 'On' : 'Off') + '</span>';
            html += '</div>';
          });
          html += '</div>';
        }

        if (!p) {
          html += '<div class="bg-white border border-dashed border-primary/50 rounded-xl p-lg max-w-2xl">';
          html += '<div class="flex items-center gap-xs font-body-md text-body-md font-bold text-on-surface"><span class="material-symbols-outlined text-primary text-[20px]">add_circle</span>New pipe</div>';
          html += '<div class="text-body-sm text-on-surface-variant mt-xs">Describe in the chat what agents should get. For example: <i>' + escapeHtml(EXAMPLE) + '</i>.</div>';
          html += '<div class="text-body-sm text-on-surface-variant mt-xs">The pipe is then run on your latest data, and the items it looked at and the ones it released are shown here. Keep describing changes until it releases what you want.</div>';
          html += '</div>';
        } else {
          var out = pp.output;
          var mine = out && out.id === p.id ? out : null;
          html += '<div class="bg-white border border-outline-variant rounded-xl shadow-sm p-md space-y-md">';
          html += '<div class="flex items-start justify-between gap-md"><div class="min-w-0">';
          html += '<h2 class="font-headline-md text-headline-md text-on-surface">' + escapeHtml(p.name) + '</h2>';
          html += '<p class="font-body-md text-body-md text-on-surface mt-xs">' + escapeHtml(p.description || 'No description.') + '</p>';
          html += '<div class="text-xs text-on-surface-variant mt-xs">Source: ' + escapeHtml(SRC[p.source] || p.source) + (p.query ? ' · searches for: <code class="font-mono">' + escapeHtml(p.query) + '</code>' : ' · looks at the newest items') + '</div></div>';
          html += '<label class="flex items-center gap-xs shrink-0 cursor-pointer text-body-sm text-on-surface-variant"><input type="checkbox" class="w-4 h-4 accent-primary" ' + (p.enabled ? 'checked' : '') + ' onchange="togglePipe(\x27' + p.id + '\x27, this.checked)">Available to agents</label>';
          html += '</div>';
          if (!p.enabled) html += '<div class="text-body-sm text-on-surface-variant bg-surface-container rounded-lg p-sm">This pipe is off: agents that call it get an error. The example below still runs for you.</div>';

          // Example run
          html += '<div><div class="flex items-center justify-between mb-xs gap-sm"><div class="font-label-caps text-label-caps text-on-surface-variant">Example on your latest data</div>';
          html += '<div class="flex items-center gap-sm text-xs text-on-surface-variant">';
          if (mine && mine.meta) html += '<span>Released ' + mine.meta.itemsReturned + ' of ' + mine.meta.itemsFetched + ' · ' + (mine.meta.duration_ms / 1000).toFixed(1) + ' s</span>';
          html += '<button onclick="runSelectedPipe()" ' + (mine && mine.loading ? 'disabled' : '') + ' class="border border-outline hover:bg-surface-container-high text-on-surface-variant px-3 py-1.5 rounded-lg disabled:opacity-50">Run again</button></div></div>';
          if (!mine || mine.loading) {
            html += '<div class="flex items-center gap-xs text-on-surface-variant text-body-sm"><div class="spinner w-4 h-4 shrink-0"></div>Reading the latest data and running the pipe…</div>';
          } else {
            if (mine.error) html += '<div class="p-sm bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm mb-sm">' + escapeHtml(mine.error) + '</div>';
            if (pp.raw && mine.body) {
              html += '<pre class="bg-surface-container rounded-lg p-3 font-mono text-xs whitespace-pre-wrap break-words max-h-96 overflow-y-auto">' + escapeHtml(JSON.stringify(mine.body, null, 2)) + '</pre>';
            } else {
              html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-md">';
              html += '<div class="min-w-0"><div class="text-xs font-semibold text-on-surface mb-xs">Input: ' + mine.input.length + ' item' + (mine.input.length === 1 ? '' : 's') + ' the pipe looked at</div>';
              if (!mine.input.length) html += '<div class="text-body-sm text-on-surface-variant bg-surface-container rounded-lg p-sm">' + (mine.error ? 'Nothing was read.' : 'The source has nothing' + (p.query ? ' matching this search' : '') + '.') + '</div>';
              else {
                html += '<div class="space-y-xs max-h-96 overflow-y-auto pr-xs">';
                mine.input.forEach(function(row) { html += pipeRowHtml(row, mine.error ? undefined : row.released); });
                html += '</div>';
              }
              html += '</div>';
              html += '<div class="min-w-0"><div class="text-xs font-semibold text-on-surface mb-xs">Output: ' + (mine.data ? mine.data.length + ' item' + (mine.data.length === 1 ? '' : 's') + ' released to agents' : 'nothing, the run failed') + '</div>';
              if (mine.data && !mine.data.length) html += '<div class="text-body-sm text-on-surface-variant bg-surface-container rounded-lg p-sm">Nothing was released. If that is not what you want, say so in the chat.</div>';
              else if (mine.data) {
                html += '<div class="space-y-xs max-h-96 overflow-y-auto pr-xs">';
                mine.data.forEach(function(row) { html += pipeRowHtml(row); });
                html += '</div>';
              }
              html += '</div></div>';
            }
            if (mine.meta && mine.limit && mine.meta.itemsFetched >= mine.limit) {
              html += '<div class="text-xs text-on-surface-variant mt-sm">This example looked at the newest ' + mine.limit + ' items' + (p.query ? ' matching the search' : '') + '; there may be more. An agent can ask for up to ' + mine.maxLimit + ' per call with <code class="font-mono">?limit=' + mine.maxLimit + '</code>.</div>';
            }
          }
          html += '</div>';

          html += '<div><div class="font-label-caps text-label-caps text-on-surface-variant mb-xs">API for agents</div>';
          html += '<div class="flex items-center gap-sm"><code id="pipe-url" class="flex-grow min-w-0 bg-surface-container rounded-lg p-2 font-mono text-xs break-all select-all">GET ' + escapeHtml(p.url) + '</code>';
          html += '<button onclick="copyPipeUrl()" class="border border-outline hover:bg-surface-container-high text-on-surface-variant text-xs px-3 py-1.5 rounded-lg shrink-0">' + (pp.copied ? 'Copied' : 'Copy') + '</button></div>';
          html += '<div class="text-xs text-on-surface-variant mt-xs">Allow an agent to call it in Settings → Agents.</div></div>';

          if (pp.showProgram) {
            html += '<div><div class="font-label-caps text-label-caps text-on-surface-variant mb-xs">Program</div>';
            html += '<pre class="bg-surface-container rounded-lg p-3 font-mono text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">' + escapeHtml(p.program) + '</pre></div>';
          }

          html += '<div class="flex items-center justify-between pt-xs border-t border-outline-variant/60">';
          html += '<div class="flex items-center gap-md">';
          html += '<button onclick="state.pipes.showProgram=!state.pipes.showProgram; render()" class="text-xs text-on-surface-variant underline">' + (pp.showProgram ? 'Hide program' : 'Show program') + '</button>';
          html += '<button onclick="state.pipes.raw=!state.pipes.raw; render()" class="text-xs text-on-surface-variant underline">' + (pp.raw ? 'Show input and output' : 'Show raw JSON (what an agent gets)') + '</button>';
          html += '</div>';
          html += '<button onclick="deletePipe(\x27' + p.id + '\x27)" class="border border-error/40 hover:bg-error/10 text-error text-xs px-3 py-1.5 rounded-lg">Delete pipe</button>';
          html += '</div></div>';
        }
      }
      html += '</div></div>';
      return renderTwoPanel('pipes', html);
    }
