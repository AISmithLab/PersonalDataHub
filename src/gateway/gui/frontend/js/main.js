var currentTab = 'ai';
    var ALL_FIELDS = ['Subject', 'Body', 'Sender', 'Recipients', 'Labels', 'Attachments', 'Snippet'];
    var DEMO_EMAILS = [
      { id:'e1', from:'alice@company.com', to:'owner@gmail.com', subject:'Q1 Planning Meeting', snippet:'Can we reschedule Thursday\'s meeting to 2pm?', body:'Hi,\n\nCan we reschedule Thursday\'s meeting to 2pm? I have a conflict with the original time.\n\nThanks,\nAlice', date:'2025-02-22T09:15:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e2', from:'bob@company.com', to:'owner@gmail.com', subject:'Code Review: PR #142', snippet:'Please review the latest changes to the auth module', body:'Hey,\n\nI\'ve pushed the latest changes to the auth module. Could you take a look at PR #142?\n\nThe main changes are:\n- Added JWT refresh logic\n- Fixed session expiry bug\n- Updated tests\n\nThanks!', date:'2025-02-22T08:30:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e3', from:'notifications@github.com', to:'owner@gmail.com', subject:'[PersonalDataHub] Issue #23: Add rate limiting', snippet:'New issue opened by contributor', body:'A new issue has been opened in owner/PersonalDataHub:\n\nTitle: Add rate limiting to API endpoints\nOpened by: @contributor\n\nWe should add rate limiting to prevent abuse of the API endpoints.', date:'2025-02-22T07:45:00Z', labels:['Inbox','GitHub'], hasAttachment:false },
      { id:'e4', from:'team@company.com', to:'owner@gmail.com', subject:'Weekly Standup Notes - Feb 21', snippet:'Here are this week\'s standup notes', body:'Team standup notes:\n\n- Alice: Finishing Q1 roadmap\n- Bob: Auth module refactor\n- Carol: Performance testing\n- Owner: Access control gateway MVP\n\nAction items:\n1. Schedule Q1 review\n2. Deploy staging build', date:'2025-02-21T17:00:00Z', labels:['Inbox','Starred'], hasAttachment:false },
      { id:'e5', from:'carol@company.com', to:'owner@gmail.com', subject:'Performance Report Q4', snippet:'Attached is the Q4 performance report with benchmarks', body:'Hi,\n\nPlease find attached the Q4 performance report. Key highlights:\n- API latency reduced by 34%\n- Uptime: 99.97%\n- Error rate: 0.02%\n\nLet me know if you have questions.', date:'2025-02-21T14:20:00Z', labels:['Inbox'], hasAttachment:true },
      { id:'e6', from:'noreply@stripe.com', to:'owner@gmail.com', subject:'Your January invoice is ready', snippet:'Your invoice for January 2025 is now available', body:'Your invoice for January 2025 is now available.\n\nAmount: $49.00\nPlan: Pro\nPeriod: Jan 1 - Jan 31, 2025\n\nView your invoice at dashboard.stripe.com', date:'2025-02-01T10:00:00Z', labels:['Inbox'], hasAttachment:true },
      { id:'e7', from:'owner@gmail.com', to:'team@company.com', subject:'Project Update - PersonalDataHub', snippet:'Quick update on the access control project', body:'Team,\n\nQuick update on PersonalDataHub:\n- OAuth flow completed\n- Gmail integration working\n- GitHub permissions UI done\n- Next: Action staging & audit log\n\nETA for MVP: end of February.', date:'2025-02-20T09:00:00Z', labels:['Sent'], hasAttachment:false },
      { id:'e8', from:'security@google.com', to:'owner@gmail.com', subject:'Security alert: New sign-in', snippet:'We noticed a new sign-in to your Google Account', body:'We noticed a new sign-in to your Google Account.\n\nDevice: MacBook Pro\nLocation: San Francisco, CA\nTime: Feb 19, 2025 3:45 PM\n\nIf this was you, you can disregard this email.', date:'2025-02-19T15:45:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e9', from:'dave@external.io', to:'owner@gmail.com', subject:'Partnership Proposal', snippet:'Would love to discuss a potential integration', body:'Hi,\n\nI\'m Dave from External.io. We\'d love to discuss a potential integration between our platform and PersonalDataHub.\n\nWould you be available for a 30-min call next week?\n\nBest,\nDave', date:'2025-02-18T11:30:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e10', from:'hr@company.com', to:'owner@gmail.com', subject:'Benefits Enrollment Reminder', snippet:'Open enrollment closes Feb 28', body:'Reminder: Open enrollment for 2025 benefits closes on February 28.\n\nPlease review and update your selections at benefits.company.com.\n\nQuestions? Contact HR.', date:'2025-02-15T08:00:00Z', labels:['Inbox'], hasAttachment:true },
      { id:'e11', from:'alice@company.com', to:'owner@gmail.com', subject:'Re: API Design Review', snippet:'Looks good, just a few minor suggestions', body:'Looks good overall! A few suggestions:\n\n1. Consider pagination for the list endpoint\n2. Add rate limiting headers\n3. Document the error codes\n\nOtherwise LGTM.', date:'2025-02-14T16:00:00Z', labels:['Inbox'], hasAttachment:false },
      { id:'e12', from:'newsletter@techweekly.com', to:'owner@gmail.com', subject:'This Week in Tech: AI Privacy Concerns', snippet:'The latest on AI regulation and data privacy', body:'This Week in Tech Newsletter\n\n1. EU proposes new AI transparency rules\n2. Major breach at social media company\n3. Open source privacy tools gaining traction\n4. Interview: Building privacy-first AI agents\n\nRead more at techweekly.com', date:'2025-02-13T06:00:00Z', labels:['Inbox','Newsletter'], hasAttachment:false },
    ];

    var state = {
      sources: [], filters: [], staging: [], audit: [],
      gmail: {},
      github: { repoList: [], reposLoading: false, reposLoaded: false, filterOwner: '', search: '' },
      expandedRepos: {},
      expandedEmail: null,
      editingAction: null,
      realEmails: null,
      emailsLoading: false,
      emailsError: null,
      realEvents: null,
      eventsLoading: false,
      eventsError: null,
      filterTypes: {},
      contacts: { data: {}, loading: false, error: null },
      sms: { messages: null, loading: false, error: null, box: 'inbox', contextMenu: null, autoReplying: false },
      chat: { messages: [], loading: false, error: null, aiAvailable: false, stagedSmsIds: [], codeBlocks: {}, configuredModel: '' },
      memories: { items: [], loading: false, loaded: false, editingId: null, editContent: '', adding: false, newContent: '', error: null },
      skills: { items: [], loading: false, loaded: false, editingId: null, editContent: { name: '', instructions: '', trigger_event: 'sms_received', current_view: 'SUMMARIZED', logic_tree: [] }, adding: false, newName: '', newInstructions: '', newTrigger: 'sms_received', newCurrentView: 'SUMMARIZED', newLogicTree: [], error: null, isTranslating: {} },
      settingsProvider: 'anthropic',
      autoReply: { enabled: false, maxToolRounds: 3, loading: false, testResult: null, testLoading: false },
      settingsSection: 'ai',
    };
    var _saveTimer = null;

    // Sidebar + bottom-nav switching
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.nav-item[data-tab], #bottom-nav a[data-tab]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.tab === tab);
      });
      render();
    }
    window.switchTab = switchTab;

    function injectDemoQuestion(text) {
      var input = document.getElementById('chat-input');
      if (input) {
        input.value = text;
        sendChatMessage();
      }
    }
    window.injectDemoQuestion = injectDemoQuestion;

    async function fetchData() {
      try {
        var resList = await Promise.all([
          fetch('/api/sources').then(function(r) { return r.json(); }),
          fetch('/api/filters').then(function(r) { return r.json(); }),
          fetch('/api/staging').then(function(r) { return r.json(); }),
          fetch('/api/audit?limit=20').then(function(r) { return r.json(); })
        ]);
        var sources = resList[0];
        var filtersData = resList[1];
        var staging = resList[2];
        var audit = resList[3];

        state.sources = sources.sources || [];
        state.filters = filtersData.filters || [];
        state.filterTypes = filtersData.filterTypes || {};
        state.staging = staging.actions || [];
        state.audit = audit.entries || [];
      } catch (err) {
        console.warn('[fetchData] Failed to fetch backend data:', err);
      }

      // Fetch real emails if Gmail is connected (uses preview with filters)
      var gm = state.sources.find(function(s) { return s.name === 'gmail'; });
      if (gm && gm.connected && !state.realEmails && !state.emailsLoading) {
        state.emailsLoading = true;
        state.emailsError = null;
        fetch('/api/gmail/preview?limit=20&t=' + Date.now())
          .then(function(r) { return r.json(); })
          .then(function(data) {
            state.emailsLoading = false;
            state.realEmails = data.messages || [];
            if (currentTab === 'gmail') render();
          })
          .catch(function(err) {
            state.emailsLoading = false;
            state.emailsError = err.message || 'Network error';
            if (currentTab === 'gmail') render();
          });
      }

      // Fetch real calendar events if Google Calendar is connected
      var cal = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      if (cal && cal.connected && !state.realEvents && !state.eventsLoading) {
        state.eventsLoading = true;
        state.eventsError = null;
        fetch('/api/google_calendar/preview?limit=20&t=' + Date.now())
          .then(function(r) { return r.json(); })
          .then(function(data) {
            state.eventsLoading = false;
            state.realEvents = data.events || [];
            if (currentTab === 'google_calendar') render();
          })
          .catch(function(err) {
            state.eventsLoading = false;
            state.eventsError = err.message || 'Network error';
            if (currentTab === 'google_calendar') render();
          });
      }
      // Check AI configuration status
      fetch('/api/chat/status').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.chat.aiAvailable = d.configured;
          if (d.provider) state.settingsProvider = d.provider;
          if (d.model) state.chat.configuredModel = d.model;
          if (currentTab === 'ai' || currentTab === 'settings') render();
        }
      }).catch(function() { /* non-fatal */ });

      // Check auto-reply status
      fetch('/api/settings/auto-reply').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.autoReply.enabled = d.enabled;
          if (typeof d.maxToolRounds === 'number') state.autoReply.maxToolRounds = d.maxToolRounds;
          if (currentTab === 'settings') render();
        }
      }).catch(function() { /* non-fatal */ });

      // Load skills
      fetch('/api/skills').then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.skills.items = d.skills;
          state.skills.loaded = true;
          if (currentTab === 'skill') render();
        }
      }).catch(function() { /* non-fatal */ });

      render();
    }

    function loadSkills(force) {
      if (!force && state.skills.loaded) return;
      if (state.skills.loading) return;
      state.skills.loading = true;
      fetch('/api/skills').then(function(r) { return r.json(); }).then(function(d) {
        state.skills.loading = false;
        if (d.ok) { state.skills.items = d.skills; state.skills.loaded = true; if (currentTab === 'skill') render(); }
      }).catch(function() { state.skills.loading = false; });
    }
    window.loadSkills = loadSkills;

    function loadMemories(force) {
      if (!force && state.memories.loaded) return;
      if (state.memories.loading) return;
      state.memories.loading = true;
      fetch('/api/memories').then(function(r) { return r.json(); }).then(function(d) {
        state.memories.loading = false;
        if (d.ok) {
          state.memories.items = d.memories;
          state.memories.loaded = true;
          if (currentTab === 'memory') render();
          else {
            var el = document.getElementById('mem-count-display');
            if (el) el.textContent = d.memories.length + ' memories saved';
          }
        }
      }).catch(function() { state.memories.loading = false; });
    }
    window.loadMemories = loadMemories;

    function deleteMemory(id) {
      fetch('/api/memories/' + encodeURIComponent(id), { method: 'DELETE' }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) { state.memories.items = state.memories.items.filter(function(m) { return m.id !== id; }); render(); }
      }).catch(function() {});
    }
    window.deleteMemory = deleteMemory;

    function startEditMemory(id) {
      var m = state.memories.items.find(function(x) { return x.id === id; });
      if (!m) return;
      state.memories.editingId = id;
      state.memories.editContent = m.content;
      render();
    }
    window.startEditMemory = startEditMemory;

    function cancelEditMemory() {
      state.memories.editingId = null;
      state.memories.editContent = '';
      render();
    }
    window.cancelEditMemory = cancelEditMemory;

    function saveEditMemory(id) {
      var content = state.memories.editContent.trim();
      if (!content) return;
      fetch('/api/memories/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.memories.items = state.memories.items.map(function(m) {
            return m.id === id ? Object.assign({}, m, { content: content }) : m;
          });
          state.memories.editingId = null;
          state.memories.editContent = '';
          render();
        }
      }).catch(function() {});
    }
    window.saveEditMemory = saveEditMemory;

    function updateMemoryEditContent(val) {
      state.memories.editContent = val;
    }
    window.updateMemoryEditContent = updateMemoryEditContent;

    function toggleAddMemory() {
      state.memories.adding = !state.memories.adding;
      state.memories.newContent = '';
      state.memories.error = null;
      render();
    }
    window.toggleAddMemory = toggleAddMemory;

    function updateNewMemoryContent(val) {
      state.memories.newContent = val;
    }
    window.updateNewMemoryContent = updateNewMemoryContent;

    function submitNewMemory() {
      var content = state.memories.newContent.trim();
      if (!content) return;
      fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          loadMemories(true);
          state.memories.adding = false;
          state.memories.newContent = '';
          state.memories.error = null;
        } else {
          state.memories.error = d.error || 'Failed to save';
          render();
        }
      }).catch(function() { state.memories.error = 'Network error'; render(); });
    }
    window.submitNewMemory = submitNewMemory;

    function render() {
      var focused = document.activeElement;
      var focusId = focused && focused.id ? focused.id : null;
      var cursorPos = focused && focused.selectionStart != null ? focused.selectionStart : null;

      // Sync active navigation classes
      document.querySelectorAll('.nav-item[data-tab], #bottom-nav a[data-tab]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.tab === currentTab);
      });

      var content = document.getElementById('content');
      if (!content) return;
      switch (currentTab) {
        case 'overview': content.innerHTML = renderOverviewTab(); break;
        case 'gmail': content.innerHTML = renderGmailTab(); break;
        case 'github': content.innerHTML = renderGitHubTab(); break;
        case 'google_calendar': content.innerHTML = renderCalendarTab(); break;
        case 'sms': content.innerHTML = renderSmsTab(); loadContacts(); loadSmsMessages(); break;
        case 'ai': content.innerHTML = renderAiTab(); var _cm = document.getElementById('chat-messages'); if (_cm) _cm.scrollTop = _cm.scrollHeight; break;
        case 'skill': content.innerHTML = renderSkillTab(); loadSkills(); break;
        case 'memory': content.innerHTML = renderMemoryTab(); loadMemories(); break;
        case 'settings': content.innerHTML = renderSettingsTab(); loadMemories(); break;
      }
      // Update sidebar badges and status dots
      var gmailPendingCount = state.staging.filter(function(a) { return a.source === 'gmail' && a.status === 'pending'; }).length;
      var gmailBadge = document.getElementById('gmail-badge');
      if (gmailBadge) {
        if (gmailPendingCount) { gmailBadge.textContent = gmailPendingCount; gmailBadge.style.display = ''; }
        else { gmailBadge.style.display = 'none'; }
      }
      var bnGmailBadge = document.getElementById('bn-gmail-badge');
      if (bnGmailBadge) {
        if (gmailPendingCount) { bnGmailBadge.textContent = gmailPendingCount; bnGmailBadge.style.display = ''; }
        else { bnGmailBadge.style.display = 'none'; }
      }
      var calPendingCount = state.staging.filter(function(a) { return a.source === 'google_calendar' && a.status === 'pending'; }).length;
      var calBadge = document.getElementById('calendar-badge');
      if (calBadge) {
        if (calPendingCount) { calBadge.textContent = calPendingCount; calBadge.style.display = ''; }
        else { calBadge.style.display = 'none'; }
      }
      var bnCalBadge = document.getElementById('bn-cal-badge');
      if (bnCalBadge) {
        if (calPendingCount) { bnCalBadge.textContent = calPendingCount; bnCalBadge.style.display = ''; }
        else { bnCalBadge.style.display = 'none'; }
      }
      // Gmail status dot
      var gmailSource = state.sources.find(function(s) { return s.name === 'gmail'; });
      var gmailDot = document.getElementById('gmail-dot');
      if (gmailDot) {
        gmailDot.className = 'status-dot ' + (gmailSource && gmailSource.connected ? 'status-dot-connected' : 'status-dot-disconnected');
      }
      // Calendar status dot
      var calSource = state.sources.find(function(s) { return s.name === 'google_calendar'; });
      var calDot = document.getElementById('calendar-dot');
      if (calDot) {
        calDot.className = 'status-dot ' + (calSource && calSource.connected ? 'status-dot-connected' : 'status-dot-disconnected');
      }
      // GitHub status dot
      var ghSource = state.sources.find(function(s) { return s.name === 'github'; });
      var ghDot = document.getElementById('github-dot');
      if (ghDot) {
        ghDot.className = 'status-dot ' + (ghSource && ghSource.connected ? 'status-dot-connected' : 'status-dot-disconnected');
      }
      // AI status dot
      var aiDot = document.getElementById('ai-dot');
      if (aiDot) {
        aiDot.style.background = state.chat.aiAvailable ? 'var(--success)' : 'var(--muted)';
      }
      // Memory count badge
      var memBadge = document.getElementById('memory-count-badge');
      if (memBadge) {
        var mc = state.memories.items.length;
        if (mc) { memBadge.textContent = mc; memBadge.style.display = ''; }
        else { memBadge.style.display = 'none'; }
      }

      if (focusId) {
        var el = document.getElementById(focusId);
        if (el) { el.focus(); if (cursorPos != null && el.setSelectionRange) el.setSelectionRange(cursorPos, cursorPos); }
      }
    }

    function chk(v) { return v ? 'checked' : ''; }

    /* INJECT_renderOverviewTab */


    /* INJECT_renderGmailTab */


    /* INJECT_renderCalendarTab */


    /* INJECT_renderGitHubTab */


    /* INJECT_renderSmsTab */


    // Callback registry for AndroidSms.getMessages() results delivered via
    // evaluateJavascript from SmsPlugin's JavascriptInterface.
    window._smsCbs = {};
    window._smsDeliver = function(callbackId, messages, error) {
      var cb = window._smsCbs[callbackId];
      if (cb) { delete window._smsCbs[callbackId]; cb(messages, error); }
    };

    function loadSmsMessages(force) {
      if (!force && state.sms.messages !== null) return;
      if (!force && state.sms.error) return;
      if (state.sms.loading) return;

      state.sms.loading = true;
      state.sms.error = null;
      if (currentTab === 'sms') render();

      if (!window.AndroidSms) {
        state.sms.loading = false;
        state.sms.error = 'NOT_ANDROID';
        if (currentTab === 'sms') render();
        return;
      }

      var reqId = Date.now().toString();
      var timer = setTimeout(function() {
        delete window._smsCbs[reqId];
        state.sms.loading = false;
        state.sms.error = 'Timed out reading SMS — check permission in Android Settings';
        if (currentTab === 'sms') render();
      }, 10000);

      window._smsCbs[reqId] = function(messages, error) {
        clearTimeout(timer);
        state.sms.loading = false;
        if (error) {
          var el = error.toLowerCase();
          state.sms.error = (el.includes('denied') || el.includes('permission'))
            ? 'PERMISSION_DENIED' : error;
        } else {
          state.sms.messages = messages;
          state.sms.error = null;
        }
        if (currentTab === 'sms') render();
      };

      window.AndroidSms.getMessages(reqId, state.sms.box, 100);
    }
    window.loadSmsMessages = loadSmsMessages;

    window._contactsCbs = {};
    window._contactsDeliver = function(callbackId, contactsList, error) {
      var cb = window._contactsCbs[callbackId];
      if (cb) { delete window._contactsCbs[callbackId]; cb(contactsList, error); }
    };

    function loadContacts(force) {
      if (!force && Object.keys(state.contacts.data).length > 0) return;
      if (state.contacts.loading) return;
      if (!window.AndroidSms || !window.AndroidSms.getContacts) return;

      state.contacts.loading = true;
      var reqId = 'contacts_' + Date.now();
      window._contactsCbs[reqId] = function(contactsList, err) {
        state.contacts.loading = false;
        if (!err && contactsList) {
          contactsList.forEach(function(c) {
            state.contacts.data[c.number] = c.name;
            var stripped = c.number.replace(/\D/g, '');
            if (stripped.length >= 7) state.contacts.data[stripped] = c.name;
          });
          if (currentTab === 'sms') render();
        }
      };
      window.AndroidSms.getContacts(reqId);
    }
    window.loadContacts = loadContacts;

    function formatContact(addr) {
      if (!addr) return addr;
      var name = state.contacts.data[addr];
      if (!name) {
        var stripped = addr.replace(/\D/g, '');
        if (stripped.length >= 7) name = state.contacts.data[stripped];
      }
      return name ? name + ' (' + addr + ')' : addr;
    }
    window.formatContact = formatContact;

    // ---- AI chat ----

    // Callback registry for AndroidSms.sendMessage() results
    window._smsSendCbs = {};
    window._smsSendDeliver = function(callbackId, error) {
      var cb = window._smsSendCbs[callbackId];
      if (cb) { delete window._smsSendCbs[callbackId]; cb(error); }
    };

    async function sendSmsAction(actionId, to, body) {
      if (!window.AndroidSms || !window.AndroidSms.sendMessage) {
        alert('SMS sending is only available on Android.');
        return;
      }
      var cbId = 'smssend_' + Date.now();
      window._smsSendCbs[cbId] = async function(error) {
        if (error && error !== 'null') {
          alert('Failed to send SMS: ' + error);
          return;
        }
        await fetch('/api/staging/' + actionId + '/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        });
        state.chat.stagedSmsIds = state.chat.stagedSmsIds.filter(function(id) { return id !== actionId; });
        await fetchData();
      };
      window.AndroidSms.sendMessage(cbId, to, body);
    }
    window.sendSmsAction = sendSmsAction;

    // Long-press context menu for SMS messages
    var _smsLongPressTimer = null;
    function smsLongPressStart(el) {
      var address = el.getAttribute('data-address');
      var body = el.getAttribute('data-body');
      _smsLongPressTimer = setTimeout(function() {
        _smsLongPressTimer = null;
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(40);
        state.sms.contextMenu = { address: address, body: body, status: null };
        render();
      }, 600);
    }
    function smsLongPressEnd() {
      if (_smsLongPressTimer) { clearTimeout(_smsLongPressTimer); _smsLongPressTimer = null; }
    }
    function hideSmsContextMenu() {
      state.sms.contextMenu = null;
      state.sms.autoReplying = false;
      render();
    }
    async function manualAutoReply() {
      var cm = state.sms.contextMenu;
      if (!cm || state.sms.autoReplying) return;
      if (!window.AndroidSms) { alert('SMS is only available on Android.'); return; }
      state.sms.autoReplying = true;
      state.sms.contextMenu = Object.assign({}, cm, { status: 'thinking' });
      render();
      try {
        var res = await fetch('/api/sms/manual-reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: cm.address, body: cm.body }),
        });
        var d = await res.json();
        if (!d.ok || !d.reply) {
          state.sms.contextMenu = Object.assign({}, cm, { status: 'error', error: d.error || 'No reply generated' });
          state.sms.autoReplying = false;
          render();
          return;
        }
        state.sms.contextMenu = Object.assign({}, cm, { status: 'sending', reply: d.reply });
        render();
        var cbId = 'manual_' + Date.now();
        window._smsSendCbs[cbId] = function(error) {
          if (error && error !== 'null') {
            state.sms.contextMenu = Object.assign({}, state.sms.contextMenu, { status: 'error', error: 'Send failed: ' + error });
          } else {
            state.sms.contextMenu = Object.assign({}, state.sms.contextMenu, { status: 'sent' });
          }
          state.sms.autoReplying = false;
          render();
        };
        window.AndroidSms.sendMessage(cbId, cm.address, d.reply);
      } catch(e) {
        state.sms.contextMenu = Object.assign({}, cm, { status: 'error', error: e.message || 'Network error' });
        state.sms.autoReplying = false;
        render();
      }
    }
    window.smsLongPressStart = smsLongPressStart;
    window.smsLongPressEnd = smsLongPressEnd;
    window.hideSmsContextMenu = hideSmsContextMenu;
    window.manualAutoReply = manualAutoReply;

    async function rejectSmsAction(actionId) {
      await fetch('/api/staging/' + actionId + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject' }),
      });
      state.chat.stagedSmsIds = state.chat.stagedSmsIds.filter(function(id) { return id !== actionId; });
      await fetchData();
    }
    window.rejectSmsAction = rejectSmsAction;

    /* INJECT_renderMemoryTab */


    // Render assistant message content: handles fenced code blocks with Run buttons
    // and collapsible tool-call disclosures for run_code outputs.
    /* INJECT_renderMessageContent */


    async function runCodeBlock(btn, blockId) {
      var code = state.chat.codeBlocks[blockId];
      if (!code) return;
      // The output slot is the next sibling div after the <pre>
      var wrapper = btn.closest('[style*="border-radius:8px"]');
      var slot = wrapper ? wrapper.querySelector('.code-output-slot') : null;
      if (!slot) return;

      btn.disabled = true;
      btn.textContent = '...';
      slot.style.display = 'block';
      slot.innerHTML = '<div style="padding:6px 10px;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px"><span class="spinner" style="display:inline-block;width:10px;height:10px;border-width:1.5px;vertical-align:middle"></span>Running...</div>';

      try {
        var res = await fetch('/api/code/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code }),
        });
        var d = await res.json();
        if (d.ok) {
          var out = d.output || '(no output)';
          if (d.error) out += '\n[error] ' + d.error;
          slot.innerHTML = '<pre style="margin:0;padding:8px 10px;border-top:1px solid rgba(0,0,0,0.08);font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;overflow-x:auto;color:' + (d.error ? 'var(--destructive)' : 'var(--fg)') + ';white-space:pre-wrap;word-break:break-word">' + escapeHtml(out) + '</pre>';
        } else {
          slot.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--destructive);border-top:1px solid rgba(0,0,0,0.08)">Error: ' + escapeHtml(d.error || 'Unknown error') + '</div>';
        }
      } catch(e) {
        slot.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--destructive);border-top:1px solid rgba(0,0,0,0.08)">Network error: ' + escapeHtml(e.message) + '</div>';
      }
      btn.disabled = false;
      btn.textContent = 'Run';
    }
    window.runCodeBlock = runCodeBlock;

    /* INJECT_renderAiTab */


    var _voiceRecognition = null;
    function toggleVoiceInput() {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { alert('Voice input is not supported in this browser.'); return; }
      if (_voiceRecognition) {
        _voiceRecognition.stop();
        _voiceRecognition = null;
        var btn = document.getElementById('voice-btn');
        if (btn) btn.style.color = 'var(--muted)';
        return;
      }
      var rec = new SpeechRecognition();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      _voiceRecognition = rec;
      var btn = document.getElementById('voice-btn');
      if (btn) btn.style.color = 'var(--primary)';
      rec.onresult = function(e) {
        var transcript = e.results[0][0].transcript;
        var input = document.getElementById('chat-input');
        if (input) { input.value = (input.value ? input.value + ' ' : '') + transcript; input.focus(); }
        _voiceRecognition = null;
        if (btn) btn.style.color = 'var(--muted)';
      };
      rec.onerror = function() { _voiceRecognition = null; if (btn) btn.style.color = 'var(--muted)'; };
      rec.onend = function() { _voiceRecognition = null; if (btn) btn.style.color = 'var(--muted)'; };
      rec.start();
    }
    window.toggleVoiceInput = toggleVoiceInput;

    async function sendChatMessage() {
      var input = document.getElementById('chat-input');
      if (!input) return;
      var text = input.value.trim();
      if (!text || state.chat.loading) return;
      input.value = '';

      state.chat.messages.push({ role: 'user', content: text });
      state.chat.loading = true;
      state.chat.error = null;
      if (currentTab === 'ai') render();

      var msgs = state.chat.messages.slice(-50);
      var sms = null;
      if (state.sms.messages) {
        sms = state.sms.messages.map(function(m) {
          return { id: m.id, address: window.formatContact ? window.formatContact(m.address) : m.address, body: m.body, date: m.date, type: m.type, read: m.read };
        });
      }

      try {
        var res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: msgs, sms: sms }),
        });
        var data = await res.json();
        state.chat.loading = false;
        if (data.ok) {
          state.chat.messages.push({ role: 'assistant', content: data.reply, toolOutputs: data.toolOutputs || [] });
          if (data.stagedActionIds && data.stagedActionIds.length) {
            state.chat.stagedSmsIds = state.chat.stagedSmsIds.concat(data.stagedActionIds);
            await fetchData();
          }
        } else {
          state.chat.error = data.error || 'Unknown error';
        }
      } catch (err) {
        state.chat.loading = false;
        state.chat.error = err.message || 'Network error';
      }
      if (currentTab === 'ai') {
        render();
        var msgs2 = document.getElementById('chat-messages');
        if (msgs2) msgs2.scrollTop = msgs2.scrollHeight;
      }
    }
    window.sendChatMessage = sendChatMessage;

    function clearChat() {
      state.chat.messages = [];
      state.chat.error = null;
      state.chat.stagedSmsIds = [];
      state.chat.codeBlocks = {};
      if (currentTab === 'ai') render();
    }
    window.clearChat = clearChat;

    function selectProvider(val) {
      state.settingsProvider = val;
      var customUrls = { anthropic: 'https://api.anthropic.com/v1', openai: '', groq: 'https://api.groq.com/openai/v1', google: 'https://generativelanguage.googleapis.com/v1beta/openai/', ollama: 'http://localhost:11434/v1' };
      var defaultModels = { anthropic: 'claude-sonnet-4-6', openai: 'gpt-4o', groq: 'llama-3.3-70b-versatile', google: 'gemini-2.0-flash', ollama: 'llama3' };
      var urlEl = document.getElementById('ai-base-url');
      var modelEl = document.getElementById('ai-model');
      if (urlEl) urlEl.placeholder = customUrls[val] || 'https://...';
      if (modelEl && !modelEl.value) modelEl.placeholder = defaultModels[val] || 'model name';
      // Re-render just the provider pills without clobbering focused inputs
      var pillsEl = document.getElementById('provider-pills');
      if (pillsEl) pillsEl.innerHTML = renderProviderPills();
    }
    window.selectProvider = selectProvider;

    /* INJECT_renderProviderPills */


    function saveAiKey() {
      var key = document.getElementById('ai-api-key').value.trim();
      var model = document.getElementById('ai-model').value.trim();
      var provider = state.settingsProvider;
      var baseUrl = document.getElementById('ai-base-url').value.trim();
      if (!key) { alert('API key is required'); return; }
      fetch('/api/settings/ai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, model: model || undefined, provider: provider || 'anthropic', base_url: baseUrl || undefined }),
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          state.chat.aiAvailable = true;
          var flash = document.getElementById('ai-flash');
          if (flash) { flash.style.opacity = '1'; setTimeout(function() { flash.style.opacity = '0'; }, 2000); }
        } else {
          alert('Error: ' + (d.error || 'Unknown error'));
        }
      }).catch(function() { alert('Network error'); });
    }
    window.saveAiKey = saveAiKey;

    async function setAutoReply(enabled) {
      if (state.autoReply.loading) return;
      state.autoReply.loading = true;
      render();
      try {
        var res = await fetch('/api/settings/auto-reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enabled })
        });
        var d = await res.json();
        if (d.ok) {
          state.autoReply.enabled = d.enabled;
          // Request RECEIVE_SMS permission when enabling on Android
          if (enabled && window.AndroidSms) {
            var reqId = 'rcvsms_' + Date.now();
            window.AndroidSms.getMessages(reqId, 'inbox', 1); // triggers permission request for SMS group
          }
        }
      } catch(e) { /* non-fatal */ }
      state.autoReply.loading = false;
      render();
    }
    window.setAutoReply = setAutoReply;

    async function saveMaxToolRounds(value) {
      var n = parseInt(value, 10);
      if (isNaN(n) || n < 1 || n > 10) return;
      state.autoReply.maxToolRounds = n;
      try {
        await fetch('/api/settings/auto-reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: state.autoReply.enabled, maxToolRounds: n })
        });
      } catch(e) { /* non-fatal */ }
    }
    window.saveMaxToolRounds = saveMaxToolRounds;

    async function testAutoReply() {
      if (state.autoReply.testLoading) return;
      state.autoReply.testLoading = true;
      state.autoReply.testResult = null;
      render();
      try {
        var fakeFrom = '+1555' + Math.floor(1000000 + Math.random() * 9000000);
        var res = await fetch('/sms/auto-reply', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: fakeFrom, body: 'Hey, are you free later?' })
        });
        var d = await res.json();
        if (!d.ok) {
          state.autoReply.testResult = { ok: false, msg: d.error || 'Server error' };
        } else if (!d.enabled) {
          state.autoReply.testResult = { ok: false, msg: 'Toggle is OFF — enable it above first' };
        } else if (d.skipped) {
          state.autoReply.testResult = { ok: false, msg: 'Skipped: ' + (d.reason || 'unknown reason') };
        } else if (d.reply) {
          state.autoReply.testResult = { ok: true, msg: 'AI replied: "' + d.reply + '"' };
        } else {
          state.autoReply.testResult = { ok: false, msg: 'No reply generated' };
        }
      } catch(e) {
        state.autoReply.testResult = { ok: false, msg: 'Network error: ' + (e.message || e) };
      }
      state.autoReply.testLoading = false;
      render();
    }
    window.testAutoReply = testAutoReply;

    function toggleAiBaseUrl() { /* kept for compatibility; logic moved to selectProvider */ }
    window.toggleAiBaseUrl = toggleAiBaseUrl;

    var SKILL_TRIGGERS = [
      { key: 'sms_received', label: 'SMS Received' },
    ];

    /* INJECT_renderLogicalEditor */

    window.renderLogicalEditor = renderLogicalEditor;

    async function toggleEditSkillView(id) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var editContent = isAdding ? {
        name: sk.newName,
        instructions: sk.newInstructions,
        trigger_event: sk.newTrigger,
        current_view: sk.newCurrentView,
        logic_tree: sk.newLogicTree
      } : sk.editContent;

      var currentView = editContent.current_view || 'SUMMARIZED';
      var cache = sk.translationCache || {};

      if (currentView === 'LOGICAL') {
        var currentTreeJson = JSON.stringify(editContent.logic_tree);
        if (cache.logicTreeJson === currentTreeJson && cache.instructions !== undefined) {
          editContent.current_view = 'SUMMARIZED';
          editContent.instructions = cache.instructions;
          if (isAdding) {
            sk.newCurrentView = 'SUMMARIZED';
            sk.newInstructions = cache.instructions;
          }
          render();
          return;
        }
      } else {
        if (cache.instructions === editContent.instructions && cache.logicTreeJson !== undefined) {
          editContent.current_view = 'LOGICAL';
          editContent.logic_tree = JSON.parse(cache.logicTreeJson);
          if (isAdding) {
            sk.newCurrentView = 'LOGICAL';
            sk.newLogicTree = JSON.parse(cache.logicTreeJson);
          }
          render();
          return;
        }
      }

      sk.isTranslating[id] = true;
      render();

      try {
        if (currentView === 'LOGICAL') {
          // Flow A: Logical -> Summarized
          var r = await fetch('/api/skills/translate/logical-to-summarized', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logicTree: editContent.logic_tree })
          });
          var d = await r.json();
          if (d.ok) {
            editContent.instructions = d.nlSummary;
            editContent.current_view = 'SUMMARIZED';
            sk.translationCache = {
              instructions: d.nlSummary,
              logicTreeJson: JSON.stringify(editContent.logic_tree)
            };
          } else {
            alert(d.error || 'Failed to translate logic to text');
          }
        } else {
          // Flow B: Summarized -> Logical
          var r = await fetch('/api/skills/translate/summarized-to-logical', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nlSummary: editContent.instructions })
          });
          var d = await r.json();
          if (d.ok) {
            editContent.logic_tree = d.logicTree;
            editContent.current_view = 'LOGICAL';
            sk.translationCache = {
              instructions: editContent.instructions,
              logicTreeJson: JSON.stringify(d.logicTree)
            };
          } else {
            alert(d.error || 'Could not parse logic from text');
          }
        }
      } catch (e) {
        alert('Translation error: ' + e.message);
      } finally {
        sk.isTranslating[id] = false;
        if (isAdding) {
          sk.newInstructions = editContent.instructions;
          sk.newCurrentView = editContent.current_view;
          sk.newLogicTree = editContent.logic_tree;
        }
        render();
      }
    }
    window.toggleEditSkillView = toggleEditSkillView;

    function updateLogicNodeType(id, index, type) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      
      if (logicTree[index]) {
        logicTree[index].type = type;
        if (type === 'ELSE' || type === 'CONTEXT') {
          logicTree[index].condition = null;
          if (type === 'ELSE' && logicTree.length > index + 1) {
            logicTree.splice(index + 1);
          }
        } else {
          if (logicTree[index].condition === null) {
            logicTree[index].condition = '';
          }
        }
      }
      triggerSkillAutoSave(id);
      render();
    }
    window.updateLogicNodeType = updateLogicNodeType;

    function updateLogicNodeCondition(id, index, val) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      if (logicTree[index]) {
        logicTree[index].condition = val;
      }
      triggerSkillAutoSave(id);
    }
    window.updateLogicNodeCondition = updateLogicNodeCondition;

    function updateLogicNodeAction(id, index, val) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      if (logicTree[index]) {
        logicTree[index].action = val;
      }
      triggerSkillAutoSave(id);
    }
    window.updateLogicNodeAction = updateLogicNodeAction;

    function addLogicNode(id) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      var lastNode = logicTree[logicTree.length - 1];
      var newNodeId = 'node_' + Math.random().toString(36).slice(2, 9);
      
      if (lastNode && lastNode.type === 'ELSE') {
        logicTree.splice(logicTree.length - 1, 0, {
          id: newNodeId,
          type: 'ELIF',
          condition: '',
          action: ''
        });
      } else {
        logicTree.push({
          id: newNodeId,
          type: 'ELIF',
          condition: '',
          action: ''
        });
      }
      triggerSkillAutoSave(id);
      render();
    }
    window.addLogicNode = addLogicNode;

    function removeLogicNode(id, index) {
      var sk = state.skills;
      var isAdding = id === 'new';
      var logicTree = isAdding ? sk.newLogicTree : sk.editContent.logic_tree;
      
      if (logicTree.length > 1) {
        logicTree.splice(index, 1);
        if (logicTree[0]) {
          logicTree[0].type = 'IF';
          if (logicTree[0].condition === null) {
            logicTree[0].condition = '';
          }
        }
      }
      triggerSkillAutoSave(id);
      render();
    }
    window.removeLogicNode = removeLogicNode;

    var _skillSaveTimer = null;
    function triggerSkillAutoSave(id) {
      if (id === 'new') return;
      clearTimeout(_skillSaveTimer);
      _skillSaveTimer = setTimeout(function() {
        performSkillAutoSave(id);
      }, 1000);
    }
    window.triggerSkillAutoSave = triggerSkillAutoSave;

    async function performSkillAutoSave(id) {
      if (id === 'new') return;
      var sk = state.skills;
      if (sk.editingId !== id) return;
      var c = sk.editContent;
      try {
        await fetch('/api/skills/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: c.name,
            instructions: c.instructions,
            trigger_event: c.trigger_event,
            current_view: c.current_view,
            logic_tree: JSON.stringify(c.logic_tree)
          })
        });
      } catch(e) { console.warn('Auto-save failed:', e); }
    }
    window.performSkillAutoSave = performSkillAutoSave;

    /* INJECT_renderSkillCard */


    /* INJECT_renderSkillTab */


    function toggleAddSkill() {
      state.skills.adding = !state.skills.adding;
      state.skills.newName = '';
      state.skills.newInstructions = '';
      state.skills.newTrigger = 'sms_received';
      state.skills.newCurrentView = 'SUMMARIZED';
      var initialTree = [{ id: 'node_' + Math.random().toString(36).slice(2, 9), type: 'IF', condition: '', action: '' }];
      state.skills.newLogicTree = initialTree;
      state.skills.translationCache = {
        instructions: '',
        logicTreeJson: JSON.stringify(initialTree)
      };
      render();
    }
    window.toggleAddSkill = toggleAddSkill;

    async function submitNewSkill() {
      var sk = state.skills;
      var name = sk.newName.trim();
      if (!name) { alert('Skill name is required'); return; }
      var trigger = sk.newTrigger || 'sms_received';
      var current_view = sk.newCurrentView || 'SUMMARIZED';
      var instructions = sk.newInstructions || '';
      var logic_tree_arr = sk.newLogicTree || [];
      var cache = sk.translationCache || {};

      sk.isTranslating['new'] = true;
      render();

      try {
        if (current_view === 'LOGICAL') {
          var currentTreeJson = JSON.stringify(logic_tree_arr);
          if (cache.logicTreeJson !== currentTreeJson) {
            var tr = await fetch('/api/skills/translate/logical-to-summarized', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logicTree: logic_tree_arr })
            });
            var td = await tr.json();
            if (td.ok) {
              instructions = td.nlSummary;
            } else {
              throw new Error(td.error || 'Failed to translate logic to text before saving');
            }
          } else {
            if (cache.instructions !== undefined) {
              instructions = cache.instructions;
            }
          }
        } else {
          if (cache.instructions !== instructions) {
            var tr = await fetch('/api/skills/translate/summarized-to-logical', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nlSummary: instructions })
            });
            var td = await tr.json();
            if (td.ok) {
              logic_tree_arr = td.logicTree;
            } else {
              throw new Error(td.error || 'Could not parse logic from text before saving');
            }
          } else {
            if (cache.logicTreeJson !== undefined) {
              logic_tree_arr = JSON.parse(cache.logicTreeJson);
            }
          }
        }

        var r = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            instructions: instructions,
            trigger_event: trigger,
            current_view: current_view,
            logic_tree: JSON.stringify(logic_tree_arr)
          })
        });
        var d = await r.json();
        if (d.ok) {
          sk.adding = false;
          sk.newName = '';
          sk.newInstructions = '';
          sk.newCurrentView = 'SUMMARIZED';
          sk.newLogicTree = [];
          sk.translationCache = null;
          await loadSkillsAsync();
        } else {
          sk.error = d.error || 'Failed to save';
          render();
        }
      } catch(e) {
        sk.error = e.message;
        render();
      } finally {
        sk.isTranslating['new'] = false;
        render();
      }
    }
    window.submitNewSkill = submitNewSkill;

    async function loadSkillsAsync() {
      var d = await fetch('/api/skills').then(function(r) { return r.json(); });
      if (d.ok) { state.skills.items = d.skills; state.skills.loaded = true; render(); }
    }

    function startEditSkill(id) {
      var skill = state.skills.items.find(function(s) { return s.id === id; });
      if (!skill) return;
      state.skills.editingId = id;
      var parsedLogic = [];
      try {
        parsedLogic = JSON.parse(skill.logic_tree || '[]');
      } catch (e) {
        parsedLogic = [{ id: 'node_' + Math.random().toString(36).slice(2, 9), type: 'IF', condition: '', action: '' }];
      }
      if (!parsedLogic.length) {
        parsedLogic = [{ id: 'node_' + Math.random().toString(36).slice(2, 9), type: 'IF', condition: '', action: '' }];
      }
      state.skills.editContent = {
        name: skill.name,
        instructions: skill.instructions,
        trigger_event: skill.trigger_event,
        current_view: skill.current_view || 'SUMMARIZED',
        logic_tree: parsedLogic
      };
      state.skills.translationCache = {
        instructions: skill.instructions,
        logicTreeJson: JSON.stringify(parsedLogic)
      };
      render();
    }
    window.startEditSkill = startEditSkill;

    function cancelEditSkill() { state.skills.editingId = null; render(); }
    window.cancelEditSkill = cancelEditSkill;

    async function saveEditSkill(id) {
      var sk = state.skills;
      var c = sk.editContent;
      var cache = sk.translationCache || {};
      
      var name = c.name;
      var trigger = c.trigger_event;
      var current_view = c.current_view || 'SUMMARIZED';
      var instructions = c.instructions;
      var logic_tree_arr = c.logic_tree;

      sk.isTranslating[id] = true;
      render();

      try {
        if (current_view === 'LOGICAL') {
          var currentTreeJson = JSON.stringify(logic_tree_arr);
          if (cache.logicTreeJson !== currentTreeJson) {
            // Logic tree has changed! Generate new instructions (nlSummary) via translation
            var tr = await fetch('/api/skills/translate/logical-to-summarized', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ logicTree: logic_tree_arr })
            });
            var td = await tr.json();
            if (td.ok) {
              instructions = td.nlSummary;
              c.instructions = td.nlSummary;
              sk.translationCache = {
                instructions: td.nlSummary,
                logicTreeJson: currentTreeJson
              };
            } else {
              throw new Error(td.error || 'Failed to translate logic to text before saving');
            }
          } else {
            // No changes to logic tree, use cached instructions
            if (cache.instructions !== undefined) {
              instructions = cache.instructions;
            }
          }
        } else {
          // current_view === 'SUMMARIZED'
          if (cache.instructions !== instructions) {
            // Instructions have changed! Generate new logic tree via translation
            var tr = await fetch('/api/skills/translate/summarized-to-logical', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nlSummary: instructions })
            });
            var td = await tr.json();
            if (td.ok) {
              logic_tree_arr = td.logicTree;
              c.logic_tree = td.logicTree;
              sk.translationCache = {
                instructions: instructions,
                logicTreeJson: JSON.stringify(td.logicTree)
              };
            } else {
              throw new Error(td.error || 'Could not parse logic from text before saving');
            }
          } else {
            // No changes to instructions, use cached logic tree
            if (cache.logicTreeJson !== undefined) {
              logic_tree_arr = JSON.parse(cache.logicTreeJson);
            }
          }
        }

        // Now save both to storage
        var r = await fetch('/api/skills/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            instructions: instructions,
            trigger_event: trigger,
            current_view: current_view,
            logic_tree: JSON.stringify(logic_tree_arr)
          })
        });
        var d = await r.json();
        if (d.ok) {
          state.skills.editingId = null;
          await loadSkillsAsync();
        } else {
          state.skills.error = d.error || 'Failed to save';
          render();
        }
      } catch(e) {
        state.skills.error = e.message;
        render();
      } finally {
        sk.isTranslating[id] = false;
        render();
      }
    }
    window.saveEditSkill = saveEditSkill;

    async function toggleSkillActive(id, enabled) {
      await fetch('/api/skills/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enabled }) });
      await loadSkillsAsync();
    }
    window.toggleSkillActive = toggleSkillActive;

async function deleteSkill(id) {
      if (!confirm('Delete this skill?')) return;
      await fetch('/api/skills/' + id, { method: 'DELETE' });
      await loadSkillsAsync();
    }
    window.deleteSkill = deleteSkill;

    /* INJECT_renderSettingsTab */


    function toggleEmailExpand(emailId) {
      state.expandedEmail = state.expandedEmail === emailId ? null : emailId;
      render();
    }

    function toggleEditAction(actionId) {
      state.editingAction = state.editingAction === actionId ? null : actionId;
      render();
    }

    // --- Quick filter functions ---
    /* INJECT_renderFilterCards */


    /* INJECT_renderCalendarFilterCards */


    async function toggleCalendarFilter(type, enabled, existingId) {
      var valEl = document.getElementById('cal-filter-val-' + type);
      var value = valEl ? valEl.value : '';
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'google_calendar', type: type, value: value, enabled: enabled ? 1 : 0 })
      });
      state.realEvents = null;
      await fetchData();
    }

    async function updateCalendarFilterValue(type, value, existingId) {
      var filter = (state.filters || []).find(function(f) { return f.type === type && f.source === 'google_calendar'; });
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'google_calendar', type: type, value: value, enabled: filter ? filter.enabled : 0 })
      });
      if (filter && filter.enabled) {
        state.realEvents = null;
        await fetchData();
      } else {
        var filtersData = await fetch('/api/filters').then(function(r) { return r.json(); });
        state.filters = filtersData.filters || [];
      }
    }

    async function toggleFilter(type, enabled, existingId) {
      var valEl = document.getElementById('filter-val-' + type);
      var value = valEl ? valEl.value : '';
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'gmail', type: type, value: value, enabled: enabled ? 1 : 0 })
      });
      // Refresh emails to reflect new filters
      state.realEmails = null;
      await fetchData();
    }

    async function updateFilterValue(type, value, existingId) {
      // Only save if filter is currently enabled
      var filter = (state.filters || []).find(function(f) { return f.type === type && f.source === 'gmail'; });
      await fetch('/api/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingId || undefined, source: 'gmail', type: type, value: value, enabled: filter ? filter.enabled : 0 })
      });
      if (filter && filter.enabled) {
        state.realEmails = null;
        await fetchData();
      } else {
        // Still update local state so the value is saved
        var filtersData = await fetch('/api/filters').then(function(r) { return r.json(); });
        state.filters = filtersData.filters || [];
      }
    }

    async function sendAction(actionId) {
      var editTo = document.getElementById('edit-to-' + actionId);
      if (editTo) {
        await fetch('/api/staging/' + actionId + '/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_data: {
            to: document.getElementById('edit-to-' + actionId).value,
            subject: document.getElementById('edit-subj-' + actionId).value,
            body: document.getElementById('edit-body-' + actionId).value,
            send: true
          }})
        });
      }
      await resolveAction(actionId, 'approve');
    }

    // --- Toggle repo expand/collapse ---
    function toggleRepo(repo) {
      state.expandedRepos[repo] = !state.expandedRepos[repo];
      render();
    }

    function saveGithub() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(function() {
        var payload = {};
        state.github.repoList.forEach(function(r) {
          payload[r.full_name] = {
            enabled: !!r.enabled,
            permissions: typeof r.permissions === 'string' ? JSON.parse(r.permissions) : r.permissions
          };
        });
        fetch('/api/github/repos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repos: payload })
        }).then(function() { flash('github-flash'); });
      }, 500);
    }

    async function fetchGithubRepos() {
      state.github.reposLoading = true;
      render();
      try {
        var res = await fetch('/api/github/repos');
        var data = await res.json();
        if (data.ok && data.repos) {
          state.github.repoList = data.repos.map(function(r) {
            return {
              full_name: r.full_name,
              owner: r.owner,
              name: r.name,
              private: r.private,
              description: r.description,
              is_org: r.is_org,
              enabled: r.enabled,
              permissions: r.permissions
            };
          });
          state.github.reposLoaded = true;
        }
      } catch (err) {
        console.error('Failed to fetch GitHub repos:', err);
      }
      state.github.reposLoading = false;
      render();
    }

    function toggleRepoEnabled(fullName, checked) {
      var repo = state.github.repoList.find(function(r) { return r.full_name === fullName; });
      if (repo) {
        repo.enabled = checked ? 1 : 0;
        repo.permissions = checked ? '["contents:read","issues:read","pull_requests:read"]' : '[]';
      }
      saveGithub();
      render();
    }

    function toggleRepoPerm(fullName, perm, checked) {
      var repo = state.github.repoList.find(function(r) { return r.full_name === fullName; });
      if (!repo) return;
      var perms = typeof repo.permissions === 'string' ? JSON.parse(repo.permissions) : repo.permissions.slice();
      if (checked && perms.indexOf(perm) === -1) perms.push(perm);
      if (!checked) perms = perms.filter(function(p) { return p !== perm; });
      repo.permissions = JSON.stringify(perms);
      saveGithub();
      render();
    }

    function selectAllOwner(owner, val) {
      state.github.repoList.forEach(function(r) {
        if (r.owner === owner) {
          r.enabled = val ? 1 : 0;
          r.permissions = val ? '["contents:read","issues:read","pull_requests:read"]' : '[]';
        }
      });
      saveGithub();
      render();
    }

    function applyBulkPerms() {
      var perms = [];
      if (document.getElementById('bulk-code-read').checked) perms.push('contents:read');
      if (document.getElementById('bulk-code-write').checked) perms.push('contents:write');
      if (document.getElementById('bulk-issues-read').checked) perms.push('issues:read');
      if (document.getElementById('bulk-issues-write').checked) perms.push('issues:write');
      if (document.getElementById('bulk-prs-read').checked) perms.push('pull_requests:read');
      if (document.getElementById('bulk-prs-write').checked) perms.push('pull_requests:write');
      var permStr = JSON.stringify(perms);
      state.github.repoList.forEach(function(r) {
        if (r.enabled) r.permissions = permStr;
      });
      saveGithub();
      render();
    }

    function flash(id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('show'); setTimeout(function() { el.classList.remove('show'); }, 1500); }
      // Also flash sidebar footer
      var sf = document.getElementById('sidebar-flash');
      if (sf) { sf.classList.add('show'); setTimeout(function() { sf.classList.remove('show'); }, 1500); }
    }

    // --- OAuth actions ---
    function startOAuth(source) {
      window.location.href = '/oauth/' + source + '/start';
    }

    async function disconnectSource(source) {
      if (!confirm('Disconnect ' + source + '? You will need to re-authorize.')) return;
      await fetch('/oauth/' + source + '/disconnect', { method: 'POST' });
      if (source === 'gmail') {
        state.realEmails = null;
        state.emailsLoading = false;
      }
      if (source === 'google_calendar') {
        state.realEvents = null;
        state.eventsLoading = false;
      }
      await fetchData();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeAttr(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatResponsePreview(raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
          var items = parsed.data;
          var first = items[0].data || items[0];
          if (first.title || first.author_email || first.subject || first.author_name) {
            var total = (parsed.meta && parsed.meta.itemsReturned) || items.length;
            var subjects = items.map(function(item) {
              var d = item.data || item;
              return d.title || d.subject || '(no subject)';
            });
            var preview = total + ' item(s)';
            if (total > items.length) preview += ' (showing ' + items.length + ')';
            preview += ': ' + subjects.join(', ');
            return escapeHtml(preview);
          }
        }
      } catch(e) {}
      return escapeHtml(raw.slice(0, 160)) + (raw.length > 160 ? '...' : '');
    }

    function formatResponseDetails(raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed.data && Array.isArray(parsed.data) && parsed.data.length > 0) {
          var items = parsed.data;
          var first = items[0].data || items[0];
          if (first.title || first.author_email || first.subject || first.author_name) {
            var html = '<table style="width:100%;font-size:12px;border-collapse:collapse;margin:4px 0">';
            html += '<tr style="background:var(--bg)"><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">From</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Subject</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Date</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">Preview</th></tr>';
            items.forEach(function(item) {
              var d = item.data || item;
              var from = d.author_email || d.author_name || d.from || '';
              var subject = d.title || d.subject || '';
              var preview = d.snippet || (d.body ? String(d.body).slice(0, 120) : '') || '';
              var dateStr = d.date || item.timestamp || '';
              var dateFmt = dateStr ? new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
              html += '<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);white-space:nowrap">' + escapeHtml(from) + '</td><td style="padding:4px 8px;border-bottom:1px solid var(--border)">' + escapeHtml(subject) + '</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);white-space:nowrap;color:var(--muted)">' + escapeHtml(dateFmt) + '</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--muted)">' + escapeHtml(preview.slice(0, 120)) + '</td></tr>';
            });
            html += '</table>';
            if (parsed.meta) {
              var total = parsed.meta.itemsReturned || 0;
              var shown = items.length;
              var msg = shown < total
                ? 'Showing ' + shown + ' of ' + total + ' items returned (' + parsed.meta.itemsFetched + ' fetched)'
                : total + ' of ' + parsed.meta.itemsFetched + ' items returned';
              html += '<div style="font-size:11px;color:var(--muted);margin-top:4px">' + escapeHtml(msg) + '</div>';
            }
            return html;
          }
        }
      } catch(e) {}
      return '<pre style="white-space:pre-wrap;word-break:break-all;margin:4px 0;padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;max-height:300px;overflow:auto;font-size:11px">' + raw.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</pre>';
    }

    function relativeTime(dateStr) {
      if (!dateStr) return '';
      var now = Date.now();
      var then = new Date(dateStr + (dateStr.indexOf('Z') === -1 && dateStr.indexOf('+') === -1 ? 'Z' : '')).getTime();
      var diff = Math.floor((now - then) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
      if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
      return Math.floor(diff / 86400) + 'd ago';
    }

    function actionTypeLabel(type) {
      var labels = { draft_email: 'Draft Email', send_email: 'Send Email', reply_email: 'Reply' };
      return labels[type] || type;
    }

    function approveLabel(type) {
      var labels = { draft_email: 'Approve & Save Draft', send_email: 'Approve & Send', reply_email: 'Approve & Send Reply' };
      return labels[type] || 'Approve';
    }

    /* INJECT_renderPendingCards */


    function editAction(actionId) {
      ['to', 'subj', 'body'].forEach(function(f) {
        var d = document.getElementById('display-' + f + '-' + actionId);
        var e = document.getElementById('edit-' + f + '-' + actionId);
        if (d) d.style.display = 'none';
        if (e) e.style.display = '';
      });
      var eb = document.getElementById('edit-btn-' + actionId);
      var cb = document.getElementById('cancel-btn-' + actionId);
      if (eb) eb.style.display = 'none';
      if (cb) cb.style.display = '';
    }

    function cancelEdit(actionId) {
      ['to', 'subj', 'body'].forEach(function(f) {
        var d = document.getElementById('display-' + f + '-' + actionId);
        var e = document.getElementById('edit-' + f + '-' + actionId);
        if (d) d.style.display = '';
        if (e) e.style.display = 'none';
      });
      var eb = document.getElementById('edit-btn-' + actionId);
      var cb = document.getElementById('cancel-btn-' + actionId);
      if (eb) eb.style.display = '';
      if (cb) cb.style.display = 'none';
    }

    async function clearAuditLog() {
      if (!confirm('Delete all audit log history? This cannot be undone.')) return;
      await fetch('/api/audit', { method: 'DELETE' });
      state.audit = [];
      render();
    }
    window.clearAuditLog = clearAuditLog;

    async function approveAction(actionId) {
      var editTo = document.getElementById('edit-to-' + actionId);
      if (editTo && editTo.style.display !== 'none') {
        await fetch('/api/staging/' + actionId + '/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action_data: {
            to: document.getElementById('edit-to-' + actionId).value,
            subject: document.getElementById('edit-subj-' + actionId).value,
            body: document.getElementById('edit-body-' + actionId).value
          }})
        });
      }
      await resolveAction(actionId, 'approve');
    }

    async function resolveAction(actionId, decision) {
      await fetch('/api/staging/' + actionId + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      await fetchData();
    }

    async function logout() {
      await fetch('/api/logout', { method: 'POST' });
      window.location.reload();
    }

    // Make functions available globally
    window.logout = logout;
    window.startOAuth = startOAuth;
    window.disconnectSource = disconnectSource;
    window.resolveAction = resolveAction;
    window.approveAction = approveAction;
    window.editAction = editAction;
    window.cancelEdit = cancelEdit;
    window.toggleRepo = toggleRepo;
    window.saveGithub = saveGithub;
    window.chk = chk;
    window.fetchGithubRepos = fetchGithubRepos;
    window.toggleRepoEnabled = toggleRepoEnabled;
    window.toggleRepoPerm = toggleRepoPerm;
    window.selectAllOwner = selectAllOwner;
    window.applyBulkPerms = applyBulkPerms;
    window.toggleEmailExpand = toggleEmailExpand;
    window.refreshEmails = function() {
      state.realEmails = null;
      state.emailsError = null;
      state.emailsLoading = false;
      render(); // Show loading state immediately
      fetchData();
    };
    window.refreshCalendarEvents = function() {
      state.realEvents = null;
      state.eventsError = null;
      state.eventsLoading = false;
      render(); // Show loading state immediately
      fetchData();
    };
    window.toggleEditAction = toggleEditAction;
    window.toggleFilter = toggleFilter;
    window.updateFilterValue = updateFilterValue;
    window.renderFilterCards = renderFilterCards;
    window.toggleCalendarFilter = toggleCalendarFilter;
    window.updateCalendarFilterValue = updateCalendarFilterValue;
    window.renderCalendarFilterCards = renderCalendarFilterCards;
    window.sendAction = sendAction;

    // Handle OAuth redirect results (web / query-param path)
    (function handleOAuthResult() {
      var params = new URLSearchParams(window.location.search);
      var success = params.get('oauth_success');
      var error = params.get('oauth_error');
      if (success) {
        fetchData().then(function() { switchTab(success); });
        window.history.replaceState({}, '', '/');
      }
      if (error) {
        alert('OAuth error: ' + error);
        window.history.replaceState({}, '', '/');
      }
    })();

    // Handle OAuth deep-link callbacks on Android (pdh://oauth?success=<source>).
    // The browser-side token exchange page redirects here after storing tokens,
    // which triggers the Android intent filter and fires appUrlOpen in Capacitor.
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appUrlOpen', function(event) {
        try {
          var url = new URL(event.url);
          if (url.hostname === 'oauth') {
            var success = url.searchParams.get('success');
            var error = url.searchParams.get('error');
            if (success) {
              fetchData().then(function() { switchTab(success); });
            }
            if (error) {
              alert('OAuth error: ' + error);
            }
          }
        } catch(e) {}
      });
    }

    // --- Auth: signup vs login form ---
    var isSignup = false;

    function setAuthMode(signup) {
      isSignup = signup;
      document.getElementById('login-subtitle').textContent = signup ? 'Create your account' : 'Sign in to continue';
      document.getElementById('auth-submit').textContent = signup ? 'Create Account' : 'Sign In';
      document.getElementById('auth-toggle').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create account';
      document.getElementById('login-error').textContent = '';
    }

    function toggleAuthMode() {
      setAuthMode(!isSignup);
    }
    window.toggleAuthMode = toggleAuthMode;

    function handleAuthSubmit(e) {
      e.preventDefault();
      var email = document.getElementById('auth-email').value;
      var password = document.getElementById('auth-password').value;
      var errorEl = document.getElementById('login-error');
      var btn = document.getElementById('auth-submit');
      errorEl.textContent = '';
      btn.disabled = true;
      btn.textContent = isSignup ? 'Creating account...' : 'Signing in...';

      var endpoint = isSignup ? '/auth/signup' : '/auth/login';
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .then(function(res) {
        btn.disabled = false;
        btn.textContent = isSignup ? 'Create Account' : 'Sign In';
        if (res.data.ok) {
          document.getElementById('login-screen').style.display = 'none';
          document.getElementById('app').style.display = 'flex';
          fetchData();
        } else if (res.status === 409) {
          // Account already exists — switch to sign-in mode automatically
          setAuthMode(false);
          errorEl.textContent = 'Account exists. Please sign in with your password.';
        } else {
          errorEl.textContent = res.data.error || 'Authentication failed';
        }
      }).catch(function() {
        btn.disabled = false;
        btn.textContent = isSignup ? 'Create Account' : 'Sign In';
        errorEl.textContent = 'Network error. Please try again.';
      });
      return false;
    }
    window.handleAuthSubmit = handleAuthSubmit;

    // Poll for drain-path pending auto-replies: when the app was killed and SMS was queued,
    // android.ts replays them with ?drain=true and stores in pendingAutoReplies.
    // This polling picks them up and sends via AndroidSms once the WebView is active.
    setInterval(async function() {
      if (!state.autoReply.enabled || !window.AndroidSms) return;
      try {
        var res = await fetch('/api/sms/pending-replies');
        var d = await res.json();
        if (!d.ok || !d.replies || !d.replies.length) return;
        d.replies.forEach(function(r) {
          var cbId = 'autoreply_' + r.id;
          window._smsSendCbs[cbId] = function(error) {
            if (error) console.warn('[auto-reply] send error:', error);
            fetch('/api/sms/pending-replies/' + r.id, { method: 'DELETE' }).catch(function() {});
          };
          window.AndroidSms.sendMessage(cbId, r.to, r.body);
        });
      } catch(e) { /* non-fatal */ }
    }, 3000);

    // Primary auto-reply loop: poll inbox every 5s, detect new incoming messages,
    // call /sms/auto-reply, and send the reply via AndroidSms directly.
    // This uses the same proven path as manual reply and doesn't depend on SmsReceiver.
    var _autoReplyLastMs = Date.now(); // only process messages that arrive after startup
    setInterval(function() {
      if (!state.autoReply.enabled || !window.AndroidSms || !state.chat.aiAvailable) return;
      if (!window._smsCbs) window._smsCbs = {};
      var reqId = 'autocheck_' + Date.now();
      var checkFrom = _autoReplyLastMs;
      _autoReplyLastMs = Date.now();
      window._smsCbs[reqId] = async function(messages, error) {
        if (error || !Array.isArray(messages)) return;
        // type 1 = received SMS
        var newMsgs = messages.filter(function(m) { return m.type == 1 && m.date > checkFrom; });
        for (var i = 0; i < newMsgs.length; i++) {
          var msg = newMsgs[i];
          try {
            // Collect last 10 messages in this conversation for context
            var history = messages
              .filter(function(m) { return m.address === msg.address; })
              .sort(function(a, b) { return a.date - b.date; })
              .slice(-10);
            var res = await fetch('/sms/auto-reply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: msg.address, body: msg.body, history: history }),
            });
            var d = await res.json();
            if (d.ok && d.enabled && d.reply) {
              var cbId = 'arloop_' + Date.now() + '_' + i;
              window._smsSendCbs[cbId] = function(err) {
                if (err) console.warn('[auto-reply] send failed:', err);
              };
              window.AndroidSms.sendMessage(cbId, msg.address, d.reply);
            }
          } catch(e) { /* non-fatal */ }
        }
      };
      window.AndroidSms.getMessages(reqId, 'inbox', 50);
    }, 5000);

    // Check auth on load — auto-login for single-device use
    fetch('/api/auth/status').then(function(r) { return r.json(); }).then(function(data) {
      if (data.authenticated) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        fetchData();
      } else {
        // Auto-create user + session (device is localhost — no credentials needed)
        fetch('/auth/device-login', { method: 'POST' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.ok) {
              document.getElementById('login-screen').style.display = 'none';
              document.getElementById('app').style.display = 'flex';
              fetchData();
            } else {
              document.getElementById('login-screen').style.display = 'flex';
              document.getElementById('app').style.display = 'none';
              setAuthMode(!data.hasUsers);
            }
          })
          .catch(function() {
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
            setAuthMode(false);
          });
      }
    }).catch(function() {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
      setAuthMode(false);
    });