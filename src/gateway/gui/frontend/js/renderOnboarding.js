function renderOnboardingScreen() {
      var step = state.onboarding.step;
      var idx = ONBOARDING_STEPS.indexOf(step);
      var total = ONBOARDING_STEPS.length;

      var html = '<div class="bg-surface border border-outline-variant rounded-2xl p-8 max-w-lg w-full shadow-lg flex flex-col gap-6">';

      html += '<div class="flex items-center justify-center gap-2">';
      ONBOARDING_STEPS.forEach(function(s, i) {
        var cls = i === idx ? 'w-8 bg-primary' : (i < idx ? 'w-4 bg-primary/50' : 'w-4 bg-outline-variant');
        html += '<span class="h-1.5 rounded-full transition-all ' + cls + '"></span>';
      });
      html += '</div>';

      html += '<div class="flex flex-col gap-4">';
      if (step === 'intro') html += renderOnboardingIntro();
      else if (step === 'apikey') html += renderOnboardingApiKey();
      else if (step === 'sms') html += renderOnboardingSms();
      else if (step === 'chat') html += renderOnboardingChat();
      else if (step === 'memory') html += renderOnboardingMemory();
      html += '</div>';

      html += '<div class="flex items-center justify-between pt-2 border-t border-outline-variant">';
      html += idx > 0
        ? '<button onclick="onboardingBack()" class="text-on-surface-variant hover:text-on-surface font-label-caps text-label-caps px-4 py-2 rounded-lg transition-colors">Back</button>'
        : '<span></span>';
      html += '<div class="flex items-center gap-md">';
      html += '<button onclick="skipOnboarding()" class="text-on-surface-variant hover:underline font-body-sm text-body-sm px-2">Skip</button>';
      var isLast = idx === total - 1;
      html += '<button onclick="' + (isLast ? 'finishOnboarding()' : 'onboardingNext()') + '" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2.5 rounded-xl transition-all active:scale-95 shadow-md">' + (isLast ? 'Get Started' : 'Continue') + '</button>';
      html += '</div>';
      html += '</div>';

      html += '</div>';
      return html;
    }

    function renderOnboardingIntro() {
      var h = '<div class="text-center flex flex-col items-center gap-3">';
      h += '<span class="material-symbols-outlined text-primary text-5xl">account_tree</span>';
      h += '<h1 class="font-headline-lg text-headline-lg text-on-background font-bold tracking-tight">Welcome to PersonalDataHub</h1>';
      h += '<p class="font-body-sm text-body-sm text-on-surface-variant">Your AI assistant runs on this device and only acts with your permission. Let’s set up the essentials — it takes about a minute.</p>';
      h += '</div>';
      return h;
    }

    function renderOnboardingApiKey() {
      var aiConfigured = state.chat.aiAvailable;
      var h = '<div class="flex flex-col gap-4">';
      h += '<div><h2 class="font-headline-md text-headline-md text-on-surface font-bold">Connect an AI provider</h2><p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">The assistant needs an API key to chat, auto-reply to texts, and use memories &amp; skills. You can change this anytime in Settings.</p></div>';
      h += '<div class="space-y-xs"><label class="font-label-caps text-label-caps text-on-surface-variant">Provider</label><div class="flex flex-wrap gap-xs">' + renderProviderPills() + '</div></div>';
      var placeholder = aiConfigured ? '•••••••••••• (Configured)' : 'sk-ant-...';
      h += '<div class="space-y-xs"><label class="font-label-caps text-label-caps text-on-surface-variant">API Key</label><input type="password" id="ob-ai-api-key" placeholder="' + placeholder + '" class="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm"></div>';
      h += '<div class="flex items-center gap-md">';
      h += '<button onclick="onboardingSaveAiKey()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-5 py-2 rounded-xl transition-all active:scale-95 shadow-sm">Save Key</button>';
      h += '<span id="ob-ai-flash" class="text-success font-mono-label text-mono-label opacity-0">Saved</span>';
      h += '<div class="flex items-center gap-xs"><span class="status-dot ' + (aiConfigured ? 'status-dot-connected' : 'status-dot-disconnected') + '"></span><span class="font-label-sm text-label-sm ' + (aiConfigured ? 'text-primary font-semibold' : 'text-on-surface-variant') + '">' + (aiConfigured ? 'Connected' : 'Not configured') + '</span></div>';
      h += '</div>';
      h += '</div>';
      return h;
    }

    function renderOnboardingSms() {
      var h = '<div class="flex flex-col gap-4">';
      h += '<div><h2 class="font-headline-md text-headline-md text-on-surface font-bold">SMS auto-reply</h2><p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Let the AI draft and send replies to incoming texts automatically while the app is running. You’re always in control — toggle it off anytime in Settings.</p></div>';
      h += '<div class="flex items-center gap-sm bg-white border border-outline-variant rounded-xl p-md shadow-sm">';
      h += '<label class="relative inline-block w-12 h-6 shrink-0 cursor-' + (state.autoReply.loading ? 'wait' : 'pointer') + '">';
      h += '<input type="checkbox" ' + (state.autoReply.enabled ? 'checked' : '') + ' onchange="setAutoReply(this.checked)" ' + (state.autoReply.loading ? 'disabled' : '') + ' class="sr-only peer">';
      h += '<span class="absolute inset-0 bg-secondary rounded-full transition-colors peer-checked:bg-primary"></span>';
      h += '<span class="absolute left-[2px] top-[2px] w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-6 shadow-sm"></span>';
      h += '</label>';
      h += '<div class="flex flex-col gap-base"><span class="font-body-md text-body-md font-semibold text-on-surface">' + (state.autoReply.enabled ? 'Enabled' : 'Disabled') + '</span><span class="font-body-sm text-body-sm text-on-surface-variant">Automatically handle incoming SMS notifications</span></div>';
      h += '</div>';
      if (!state.chat.aiAvailable && state.autoReply.enabled) {
        h += '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm flex gap-xs items-center shadow-sm"><span class="material-symbols-outlined text-[18px]">warning</span><span>Add an API key on the previous step first.</span></div>';
      }
      h += '<button onclick="testAutoReply()" ' + (state.autoReply.testLoading ? 'disabled' : '') + ' class="self-start bg-white hover:bg-surface-container-high border border-outline text-on-surface-variant font-label-caps text-label-caps px-4 py-2 rounded-xl transition-all active:scale-95 shadow-sm">' + (state.autoReply.testLoading ? 'Testing...' : 'Test auto-reply') + '</button>';
      if (state.autoReply.testResult) {
        var cls = state.autoReply.testResult.ok ? 'text-primary' : 'text-error';
        h += '<span class="font-body-sm text-body-sm font-semibold ' + cls + '">' + escapeHtml(state.autoReply.testResult.msg) + '</span>';
      }
      h += '</div>';
      return h;
    }

    function renderOnboardingChat() {
      var h = '<div class="flex flex-col gap-4">';
      h += '<div><h2 class="font-headline-md text-headline-md text-on-surface font-bold">Chat with your AI</h2><p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">The Chat tab is a normal conversation with your assistant. It can read your messages, photos, and connected accounts, draft replies, and take actions you approve.</p></div>';
      h += '<div class="bg-surface-container-low border border-outline-variant rounded-xl p-md space-y-sm">';
      ['Ask questions about your messages, emails, or calendar', 'Have it draft a text or summarize a conversation', 'Approve or reject any action before it happens'].forEach(function(t) {
        h += '<div class="flex items-start gap-sm"><span class="material-symbols-outlined text-primary text-[18px] mt-0.5">check_circle</span><span class="font-body-sm text-body-sm text-on-surface-variant">' + t + '</span></div>';
      });
      h += '</div>';
      h += '</div>';
      return h;
    }

    function renderOnboardingMemory() {
      var h = '<div class="flex flex-col gap-4">';
      h += '<div><h2 class="font-headline-md text-headline-md text-on-surface font-bold">Memories &amp; Skills</h2><p class="font-body-sm text-body-sm text-on-surface-variant mt-xs">Two tabs help the AI act more like you over time. You can edit either anytime.</p></div>';
      h += '<div class="space-y-sm">';
      h += '<div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm flex items-start gap-sm"><span class="material-symbols-outlined text-primary text-[20px]">database</span><div><h3 class="font-body-md text-body-md font-bold text-on-surface">Memory</h3><p class="font-body-sm text-body-sm text-on-surface-variant">Facts the AI remembers about you — preferences, people, ongoing context. Add, edit, or delete them anytime.</p></div></div>';
      h += '<div class="bg-white border border-outline-variant rounded-xl p-md shadow-sm flex items-start gap-sm"><span class="material-symbols-outlined text-primary text-[20px]">bolt</span><div><h3 class="font-body-md text-body-md font-bold text-on-surface">Skills</h3><p class="font-body-sm text-body-sm text-on-surface-variant">Reusable instructions that trigger automatically, like a house rule (e.g. "if a text mentions dinner plans, add it to my calendar").</p></div></div>';
      h += '</div>';
      h += '</div>';
      return h;
    }
