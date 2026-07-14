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
        
        html += '<div class="flex items-center justify-between gap-sm mb-sm">';
        html += '<span class="font-label-caps text-label-caps text-on-surface-variant">Editing Skill</span>';
        html += '</div>';

        html += '<div class="space-y-sm">';
        html += '<div class="flex gap-sm">';
        html += '<input id="edit-skill-name-' + safeId + '" value="' + escapeAttr(sk.editContent.name) + '" oninput="state.skills.editContent.name=this.value; triggerSkillAutoSave(\'' + safeId + '\')" onblur="performSkillAutoSave(\'' + safeId + '\')" placeholder="Skill name" class="flex-grow bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">';
        html += '<select id="edit-skill-trigger-' + safeId + '" onchange="state.skills.editContent.trigger_event=this.value; triggerSkillAutoSave(\'' + safeId + '\'); render()" class="bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm">' + triggerOptions + '</select>';
        html += '</div>';
        
        html += '<textarea id="edit-skill-instructions-' + safeId + '" oninput="state.skills.editContent.instructions=this.value; triggerSkillAutoSave(\'' + safeId + '\')" onblur="performSkillAutoSave(\'' + safeId + '\')" placeholder="Describe what the AI should do when this trigger fires…" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[120px]" rows="4">' + escapeHtml(sk.editContent.instructions) + '</textarea>';
        
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
        if (s.primitive_type) {
          html += '<span class="font-mono-label text-mono-label bg-secondary-container text-on-secondary-container px-xs py-0.5 rounded uppercase">' + escapeHtml(s.primitive_type) + '</span>';
        }
        if (s.label_tag) {
          html += '<span class="font-mono-label text-mono-label border border-outline-variant text-on-surface-variant px-xs py-0.5 rounded uppercase">' + escapeHtml(s.label_tag) + '</span>';
        }
        html += '</div>';
        html += '<div class="flex gap-xs items-center shrink-0">';
        html += '<button onclick="startEditSkill(\'' + safeId + '\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant transition-colors" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>';
        html += '<button onclick="deleteSkill(\'' + safeId + '\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-error transition-colors" title="Delete"><span class="material-symbols-outlined text-[18px]">close</span></button>';
        html += '</div>';
        html += '</div>';
        
        var displaySummary = s.summary ? s.summary : (s.instructions || 'No summary available.');
        html += '<p class="font-body-md text-body-md font-medium text-on-surface leading-relaxed mb-xs">' + escapeHtml(displaySummary) + '</p>';
        
        if (s.summary && s.instructions) {
          html += '<details class="group mt-2 mb-md">';
          html += '<summary class="cursor-pointer font-label-sm text-primary select-none list-none flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity"><span class="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">chevron_right</span>View Details</summary>';
          html += '<div class="mt-2 pl-6">';
          html += '<p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words">' + escapeHtml(s.instructions) + '</p>';
          html += '</div>';
          html += '</details>';
        } else if (!s.summary) {
          html += '<div class="mb-md"></div>';
        }
        
        var relatedHtml = '';
        if (s.primitive_type === 'label' && s.label_tag) {
          var acts = sk.items.filter(function(i) { return i.primitive_type === 'action' && i.instructions.toLowerCase().indexOf(s.label_tag.toLowerCase()) > -1; });
          if (acts.length > 0) {
            relatedHtml += '<div class="mt-xs mb-md p-3 bg-surface-container-lowest border border-outline-variant rounded-lg">';
            relatedHtml += '<div class="font-label-sm text-label-sm text-on-surface-variant mb-2">Triggers Actions:</div>';
            relatedHtml += '<div class="flex items-center gap-2 flex-wrap">';
            relatedHtml += '<span class="px-2 py-1 bg-secondary-container text-on-secondary-container rounded text-xs font-mono font-medium border border-secondary/20">[' + escapeHtml(s.label_tag) + ']</span>';
            relatedHtml += '<span class="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>';
            acts.forEach(function(a) {
              relatedHtml += '<span class="px-2 py-1 bg-primary-container text-on-primary-container rounded text-xs font-mono font-medium border border-primary/20">' + escapeHtml(a.name) + '</span>';
            });
            relatedHtml += '</div></div>';
          }
        } else if (s.primitive_type === 'action') {
          var lbls = sk.items.filter(function(i) { return i.primitive_type === 'label' && i.label_tag && s.instructions.toLowerCase().indexOf(i.label_tag.toLowerCase()) > -1; });
          if (lbls.length > 0) {
            relatedHtml += '<div class="mt-xs mb-md p-3 bg-surface-container-lowest border border-outline-variant rounded-lg">';
            relatedHtml += '<div class="font-label-sm text-label-sm text-on-surface-variant mb-2">Depends on Labels:</div>';
            relatedHtml += '<div class="flex items-center gap-2 flex-wrap">';
            lbls.forEach(function(l) {
              relatedHtml += '<span class="px-2 py-1 bg-secondary-container text-on-secondary-container rounded text-xs font-mono font-medium border border-secondary/20">[' + escapeHtml(l.label_tag) + ']</span>';
            });
            relatedHtml += '<span class="material-symbols-outlined text-[16px] text-outline">arrow_forward</span>';
            relatedHtml += '<span class="px-2 py-1 bg-primary-container text-on-primary-container rounded text-xs font-mono font-medium border border-primary/20">' + escapeHtml(s.name) + '</span>';
            relatedHtml += '</div></div>';
          }
        }
        
        html += relatedHtml;
        
        
        html += '<button onclick="toggleSkillActive(\'' + safeId + '\', ' + (isActive ? 'false' : 'true') + ')" class="border border-primary text-primary hover:bg-primary-container/10 font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95 shadow-sm">' + (isActive ? 'Disable' : 'Enable') + '</button>';
      }
      html += '</div>';
      return html;
    }