function renderSkillCard(s) {
      var sk = state.skills;
      var isEditing = sk.editingId === s.id;
      var safeId = escapeAttr(s.id);
      var isActive = !!s.enabled;
      var isTranslating = !!sk.isTranslating[s.id];
      var borderStyle = isEditing ? 'border-primary shadow-md' : isActive ? 'border-primary/50 hover:border-primary shadow-sm bg-white' : 'border-outline-variant hover:border-primary/30 shadow-sm bg-white';
      var html = '<div data-skill-id="' + safeId + '" class="border rounded-xl p-md transition-all relative ' + borderStyle + '">';
      
      if (isTranslating) {
        html += '<div class="absolute inset-0 bg-white/70 z-10 flex flex-col items-center justify-center rounded-xl gap-sm">';
        html += '<div class="spinner w-6 h-6"></div>';
        html += '<span class="font-label-sm text-label-sm font-bold text-on-surface">Translating...</span>';
        html += '</div>';
      }

      if (isEditing) {
        var triggerOptions = SKILL_TRIGGERS.map(function(t) {
          return '<option value="' + t.key + '"' + (sk.editContent.trigger_event === t.key ? ' selected' : '') + '>' + t.label + '</option>';
        }).join('');
        
        var currentView = sk.editContent.current_view || 'SUMMARIZED';

        html += '<div class="flex items-center justify-between gap-sm mb-sm">';
        html += '<span class="font-label-caps text-label-caps text-on-surface-variant">Editing Skill</span>';
        html += '<div class="flex border border-outline-variant rounded-lg overflow-hidden bg-surface-container-low p-0.5">';
        html += '<button onclick="toggleEditSkillView(\'' + safeId + '\')" class="font-label-sm text-label-sm px-3 py-1 rounded-md transition-colors ' + (currentView === 'LOGICAL' ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface') + '">Logical</button>';
        html += '<button onclick="toggleEditSkillView(\'' + safeId + '\')" class="font-label-sm text-label-sm px-3 py-1 rounded-md transition-colors ' + (currentView === 'SUMMARIZED' ? 'bg-primary text-on-primary font-semibold shadow-sm' : 'text-on-surface-variant hover:text-on-surface') + '">Summarized</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="space-y-sm">';
        html += '<div class="flex gap-sm">';
        html += '<input id="edit-skill-name-' + safeId + '" value="' + escapeAttr(sk.editContent.name) + '" oninput="state.skills.editContent.name=this.value; triggerSkillAutoSave(\'' + safeId + '\')" onblur="performSkillAutoSave(\'' + safeId + '\')" placeholder="Skill name" class="flex-grow bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '<select id="edit-skill-trigger-' + safeId + '" onchange="state.skills.editContent.trigger_event=this.value; triggerSkillAutoSave(\'' + safeId + '\'); render()" class="bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">' + triggerOptions + '</select>';
        html += '</div>';
        
        if (currentView === 'LOGICAL') {
          html += renderLogicalEditor(s.id, sk.editContent.logic_tree);
        } else {
          html += '<textarea id="edit-skill-instructions-' + safeId + '" oninput="state.skills.editContent.instructions=this.value; triggerSkillAutoSave(\'' + safeId + '\')" onblur="performSkillAutoSave(\'' + safeId + '\')" placeholder="Describe what the AI should do when this trigger fires…" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[120px]" rows="4">' + escapeHtml(sk.editContent.instructions) + '</textarea>';
        }
        
        html += '</div><div class="flex gap-sm mt-md">';
        html += '<button onclick="saveEditSkill(\'' + safeId + '\')" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95 shadow-sm">Save</button>';
        html += '<button onclick="cancelEditSkill()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Cancel</button>';
        html += '</div>';
      } else {
        html += '<div class="flex items-start justify-between gap-sm mb-xs">';
        html += '<div class="flex items-center gap-xs flex-wrap">';
        html += '<span class="font-body-md text-body-md font-bold text-on-surface">' + escapeHtml(s.name) + '</span>';
        html += '<span class="font-mono-label text-mono-label bg-surface-container text-on-surface-variant px-xs py-0.5 rounded uppercase">' + (SKILL_TRIGGERS.find(function(t){return t.key===s.trigger_event;})||{label:s.trigger_event}).label + '</span>';
        if (isActive) {
          html += '<span class="font-mono-label text-mono-label bg-primary-container text-on-primary-container px-xs py-0.5 rounded uppercase font-semibold">active</span>';
        }
        html += '</div>';
        html += '<div class="flex gap-xs items-center shrink-0">';
        html += '<button onclick="startEditSkill(\'' + safeId + '\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant transition-colors" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>';
        html += '<button onclick="deleteSkill(\'' + safeId + '\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-error transition-colors" title="Delete"><span class="material-symbols-outlined text-[18px]">close</span></button>';
        html += '</div>';
        html += '</div>';
        
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words mb-md">' + escapeHtml(s.instructions) + '</p>';
        if (!isActive) {
          html += '<button onclick="activateSkill(\'' + safeId + '\',\'' + escapeAttr(s.trigger_event) + '\')" class="border border-primary text-primary hover:bg-primary-container/10 font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 shadow-sm">Set as active</button>';
        }
      }
      html += '</div>';
      return html;
    }