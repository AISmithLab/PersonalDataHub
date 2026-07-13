function renderMemoryTab() {
      var mem = state.memories;
      var total = mem.items.length;
      var percent = Math.min(100, Math.round((total / 50) * 100));

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

      // Title & Capacity block
      html += '<div class="flex justify-between items-end pb-xs border-b border-outline-variant/60">';
      html += '<div class="flex flex-col gap-base">';
      html += '<h2 class="font-headline-lg text-headline-lg text-on-surface">AI Memory</h2>';
      html += '<div class="flex items-center gap-sm">';
      html += '<div class="w-32 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">';
      html += '<div class="h-full bg-primary" style="width: ' + percent + '%"></div>';
      html += '</div>';
      html += '<span class="font-label-sm text-label-sm text-on-surface-variant">' + total + ' / 50 memories saved</span>';
      html += '</div>';
      html += '</div>';
      html += '<button onclick="toggleAddMemory()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center gap-xs shadow-sm">';
      html += '<span class="material-symbols-outlined text-[18px]">add</span>';
      html += '<span>' + (mem.adding ? 'Cancel' : 'Add memory') + '</span>';
      html += '</button>';
      html += '</div>';

      // Error banner
      if (mem.error) {
        html += '<div class="p-md bg-error-container text-on-error-container border border-error/20 rounded-xl font-body-sm text-body-sm shadow-sm">' + escapeHtml(mem.error) + '</div>';
      }

      // Add memory form
      if (mem.adding) {
        html += '<div class="bg-surface-container-low border border-primary/40 rounded-xl p-md space-y-sm shadow-md">';
        html += '<p class="font-label-caps text-label-caps text-on-surface-variant">What should the AI remember?</p>';
        html += '<textarea id="new-memory-input" onchange="updateNewMemoryContent(this.value)" oninput="updateNewMemoryContent(this.value)" placeholder="e.g. Prefers concise replies. Works in timezone UTC+5:30." class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[80px]" rows="2">' + escapeHtml(mem.newContent) + '</textarea>';
        html += '<div class="flex gap-sm pt-xs">';
        html += '<button onclick="submitNewMemory()" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Save</button>';
        html += '<button onclick="toggleAddMemory()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-6 py-2 rounded-xl transition-all active:scale-95">Cancel</button>';
        html += '</div>';
        html += '</div>';
      }

      // Loading / Empty / List
      if (mem.loading && !total) {
        html += '<div class="flex items-center justify-center p-xl"><div class="spinner w-8 h-8"></div></div>';
      } else if (!total && !mem.adding) {
        // Empty state matching memory_redesign/code.html
        html += '<div class="bg-surface-container-low border border-outline-variant rounded-xl p-xl flex flex-col items-center justify-center text-center min-h-[300px]">';
        html += '<div class="w-16 h-16 bg-white border border-outline-variant rounded-2xl flex items-center justify-center mb-md shadow-sm">';
        html += '<span class="material-symbols-outlined text-primary text-3xl">edit_note</span>';
        html += '</div>';
        html += '<h3 class="font-headline-md text-headline-md text-on-surface mb-xs">No memories yet</h3>';
        html += '<div class="max-w-md bg-white border border-outline-variant rounded-lg p-md mt-base text-left shadow-sm">';
        html += '<div class="flex items-start gap-xs">';
        html += '<span class="font-mono-label text-mono-label bg-secondary-container text-on-secondary-container px-xs py-0.5 rounded uppercase mr-base">INFO</span>';
        html += '<p class="font-body-sm text-body-sm text-on-surface-variant">Chat with the AI and it will save facts about you <strong class="text-primary font-semibold">automatically</strong>, or add one manually using the button above.</p>';
        html += '</div>';
        html += '</div>';
        html += '</div>';
      } else {
        // Memories list
        html += '<div class="space-y-sm">';
        mem.items.forEach(function(m) {
          var isEditing = mem.editingId === m.id;
          var borderStyle = isEditing ? 'border-primary shadow-md bg-white' : 'border-outline-variant bg-white hover:border-primary/50 shadow-sm';
          html += '<div class="border rounded-xl p-md space-y-sm transition-all ' + borderStyle + '">';
          
          if (isEditing) {
            html += '<textarea id="edit-memory-' + escapeAttr(m.id) + '" onchange="updateMemoryEditContent(this.value)" oninput="updateMemoryEditContent(this.value)" class="w-full bg-white border border-outline-variant rounded-lg p-md text-body-md font-body-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm min-h-[80px]" rows="2">' + escapeHtml(mem.editContent) + '</textarea>';
            html += '<div class="flex gap-sm pt-xs">';
            html += '<button onclick="saveEditMemory(\'' + escapeAttr(m.id) + '\')" class="bg-primary hover:bg-primary-hover text-on-primary font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95">Save</button>';
            html += '<button onclick="cancelEditMemory()" class="border border-outline text-on-surface-variant hover:bg-surface-container-high font-label-caps text-label-caps px-4 py-1.5 rounded-lg transition-all active:scale-95">Cancel</button>';
            html += '</div>';
          } else {
            html += '<div class="flex items-start justify-between gap-sm">';
            html += '<p class="font-body-md text-body-md text-on-surface leading-relaxed flex-grow whitespace-pre-wrap break-words">' + escapeHtml(m.content) + '</p>';
            html += '<div class="flex gap-xs items-center shrink-0">';
            html += '<button onclick="startEditMemory(\'' + escapeAttr(m.id) + '\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-on-surface-variant transition-colors" title="Edit"><span class="material-symbols-outlined text-[18px]">edit</span></button>';
            html += '<button onclick="deleteMemory(\'' + escapeAttr(m.id) + '\')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high text-error transition-colors" title="Delete"><span class="material-symbols-outlined text-[18px]">close</span></button>';
            html += '</div>';
            html += '</div>';
            html += '<span class="font-mono-label text-mono-label text-on-surface-variant block mt-base">' + new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + '</span>';
          }
          
          html += '</div>';
        });
        html += '</div>';
      }

      html += '</div></div>';
      return html;
    }