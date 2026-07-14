function renderSkillTab() {
      var sk = state.skills;
      var html = '<div class="flex flex-col h-full bg-background">';

      // TopBar
      html += '<header class="flex justify-between items-center px-margin h-16 border-b border-outline-variant bg-surface shrink-0">';
      html += '<div class="flex items-center gap-sm">';
      html += '<span class="material-symbols-outlined text-primary">smart_toy</span>';
      html += '<h1 class="font-headline-md text-headline-md font-bold text-primary">AI Studio</h1>';
      html += '</div>';
      html += '</header>';

      // Content area
      html += '<div class="flex-grow overflow-y-auto px-margin py-md space-y-md max-w-2xl mx-auto w-full pb-24">';

      // Title block
      html += '<div class="flex justify-between items-end pb-xs border-b border-outline-variant/60">';
      html += '<div class="flex flex-col gap-base">';
      html += '<h2 class="font-headline-lg text-headline-lg text-on-surface">Skills</h2>';
      html += '<p class="font-body-sm text-body-sm text-on-surface-variant">Primitive rules (labels and actions) injected dynamically when trigger events fire.</p>';
      html += '</div>';
      html += '<button onclick="toggleAddSkill()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center gap-xs shadow-sm">';
      html += '<span class="material-symbols-outlined text-[18px]">add</span>';
      html += '<span>' + (sk.adding ? 'Cancel' : 'New skill') + '</span>';
      html += '</button>';
      html += '</div>';

      if (sk.error) {
        html += '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm shadow-sm">' + escapeHtml(sk.error) + '</div>';
      }

      if (sk.adding) {
        var triggerOpts = SKILL_TRIGGERS.map(function(t) { return '<option value="' + t.key + '">' + t.label + '</option>'; }).join('');
        var isTranslatingNew = !!sk.isTranslating['new'];
        var currentViewNew = sk.newCurrentView || 'SUMMARIZED';
        
        html += '<div data-skill-id="new" class="bg-surface-container-low border border-primary/40 rounded-xl p-md space-y-sm shadow-md relative">';
        
        if (isTranslatingNew) {
          html += '<div class="absolute inset-0 bg-white/70 z-10 flex flex-col items-center justify-center rounded-xl gap-sm">';
          html += '<div class="spinner w-6 h-6"></div>';
          html += '<span class="font-label-sm text-label-sm font-bold text-on-surface">Translating...</span>';
          html += '</div>';
        }
        
        html += '<div class="flex items-center justify-between gap-sm mb-xs">';
        html += '<span class="font-label-caps text-label-caps text-on-surface-variant">New Skill</span>';
        html += '</div>';

        html += '<div class="space-y-sm">';
        html += '<div class="flex gap-sm">';
        html += '<input id="new-skill-name" placeholder="Skill name" value="' + escapeAttr(sk.newName) + '" oninput="state.skills.newName=this.value" class="flex-grow bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '<select id="new-skill-trigger" onchange="state.skills.newTrigger=this.value; render()" class="bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">' + triggerOpts + '</select>';
        html += '</div>';
        
        html += '<textarea id="new-skill-instructions" placeholder="Describe what the AI should do when this trigger fires — context to check, reply style, behavioral rules, anything." oninput="state.skills.newInstructions=this.value" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[120px]" rows="4">' + escapeHtml(sk.newInstructions) + '</textarea>';
        
        html += '</div><div class="flex gap-sm mt-md">';
        html += '<button onclick="submitNewSkill()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95 shadow-sm">Save</button>';
        html += '<button onclick="toggleAddSkill()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Cancel</button>';
        html += '</div></div>';
      }

      if (sk.loading && !sk.items.length) {
        html += '<div class="flex items-center justify-center p-xl"><div class="spinner w-8 h-8"></div></div>';
      } else if (!sk.items.length && !sk.adding) {
        html += '<div class="bg-surface-container-low border border-outline-variant rounded-xl p-xl flex flex-col items-center justify-center text-center min-h-[300px]">';
        html += '<div class="w-16 h-16 bg-white border border-outline-variant rounded-2xl flex items-center justify-center mb-md shadow-sm">';
        html += '<span class="material-symbols-outlined text-primary text-3xl">bolt</span>';
        html += '</div>';
        html += '<h3 class="font-headline-md text-headline-md text-on-surface mb-xs">No skills yet</h3>';
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant max-w-sm">Create a skill to guide the AI\'s behavior when a trigger fires.</p>';
        html += '</div>';
      } else {
        html += '<div class="flex items-center gap-sm mt-md mb-xs">';
        html += '<select onchange="state.skills.filterType=this.value; render()" class="bg-surface border border-outline-variant rounded-lg px-2 py-1 text-label-sm font-label-sm focus:outline-none focus:border-primary shadow-sm">';
        html += '<option value="">All Types</option>';
        html += '<option value="label"' + (sk.filterType === 'label' ? ' selected' : '') + '>Labels</option>';
        html += '<option value="action"' + (sk.filterType === 'action' ? ' selected' : '') + '>Actions</option>';
        html += '</select>';
        
        var uniqueTags = [];
        sk.items.forEach(function(i) {
          if (i.label_tag && uniqueTags.indexOf(i.label_tag) === -1) uniqueTags.push(i.label_tag);
        });
        if (uniqueTags.length > 0) {
          html += '<select onchange="state.skills.filterTag=this.value; render()" class="bg-surface border border-outline-variant rounded-lg px-2 py-1 text-label-sm font-label-sm focus:outline-none focus:border-primary shadow-sm">';
          html += '<option value="">All Tags</option>';
          uniqueTags.forEach(function(tag) {
            html += '<option value="' + escapeAttr(tag) + '"' + (sk.filterTag === tag ? ' selected' : '') + '>[' + escapeHtml(tag) + ']</option>';
          });
          html += '</select>';
        }
        html += '</div>';
        
        var filteredItems = sk.items.filter(function(s) {
          if (sk.filterType && s.primitive_type !== sk.filterType) return false;
          if (sk.filterTag) {
            if (s.primitive_type === 'label') {
              if (s.label_tag !== sk.filterTag) return false;
            } else {
              if (s.instructions.toLowerCase().indexOf(sk.filterTag.toLowerCase()) === -1) return false;
            }
          }
          return true;
        });
        
        html += '<div class="space-y-sm">';
        filteredItems.forEach(function(s) { html += renderSkillCard(s); });
        html += '</div>';
      }

      html += '</div></div>';
      return html;
    }