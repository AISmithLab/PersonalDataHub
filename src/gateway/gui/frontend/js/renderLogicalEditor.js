function renderLogicalEditor(id, logicTree) {
      var isAdding = id === 'new';
      var html = '<div class="flex flex-col gap-sm mt-xs">';
      
      (logicTree || []).forEach(function(node, index) {
        var nodeId = escapeAttr(node.id || '');
        var type = node.type || 'ELIF';
        var condition = node.condition || '';
        var action = node.action || '';
        
        var isElse = type === 'ELSE';
        var isContext = type === 'CONTEXT';
        var cardBorder = isElse ? 'border-2 border-primary-container/30' : 'border border-outline-variant';
        
        html += '<div class="bg-white rounded-xl ' + cardBorder + ' logic-card-shadow p-sm space-y-sm relative group">';
        
        // Remove button
        if ((logicTree || []).length > 1) {
          html += '<button onclick="removeLogicNode(\'' + id + '\',' + index + ')" class="absolute top-2 right-2 text-error opacity-40 group-hover:opacity-100 transition-opacity">' +
            '<span class="material-symbols-outlined text-[18px]">close</span>' +
            '</button>';
        }
        
        // Header row
        html += '<div class="flex items-center gap-xs flex-wrap">';
        // Type select
        html += '<div class="bg-surface-container-high rounded px-2 py-1 flex items-center gap-1">';
        html += '<select onchange="updateLogicNodeType(\'' + id + '\',' + index + ',this.value)" class="text-label-sm font-label-sm font-bold text-on-surface bg-transparent border-none p-0 focus:ring-0 cursor-pointer">';
        html += '<option value="IF"' + (type === 'IF' ? ' selected' : '') + '>IF</option>';
        html += '<option value="ELIF"' + (type === 'ELIF' ? ' selected' : '') + '>ELIF</option>';
        html += '<option value="ELSE"' + (type === 'ELSE' ? ' selected' : '') + '>ELSE</option>';
        html += '<option value="CONTEXT"' + (type === 'CONTEXT' ? ' selected' : '') + '>CONTEXT</option>';
        html += '</select>';
        html += '</div>';
        
        // Condition Input (hidden if ELSE or CONTEXT)
        if (isElse) {
          html += '<div class="flex-grow italic text-on-surface-variant text-body-sm font-body-sm">otherwise</div>';
        } else if (isContext) {
          html += '<div class="flex-grow italic text-on-surface-variant text-body-sm font-body-sm">background context</div>';
        } else {
          html += '<div class="flex-grow border-b border-outline-variant pb-base">';
          html += '<input type="text" value="' + escapeAttr(condition) + '" oninput="updateLogicNodeCondition(\'' + id + '\',' + index + ',this.value)" onblur="performSkillAutoSave(\'' + id + '\')" placeholder="e.g., user asks for pricing" class="w-full border-none focus:ring-0 p-0 text-body-sm font-body-sm italic text-on-surface bg-transparent">';
          html += '</div>';
        }
        
        html += '<span class="text-mono-label font-mono-label text-on-surface-variant">' + (isContext ? 'INFO' : 'THEN') + '</span>';
        html += '</div>';
        
        // Action Input
        var actionPlaceholder = isContext ? 'e.g., check all calendars for conflicts' : 'e.g., send pricing PDF';
        html += '<div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-2 shadow-sm">';
        html += '<textarea oninput="updateLogicNodeAction(\'' + id + '\',' + index + ',this.value)" onblur="performSkillAutoSave(\'' + id + '\')" placeholder="' + actionPlaceholder + '" class="w-full border-none focus:ring-0 p-0 text-body-sm font-body-sm text-on-surface bg-transparent resize-none" rows="1">' + escapeHtml(action) + '</textarea>';
        html += '</div>';
        
        html += '</div>';
      });
      
      // Add Node Button
      html += '<div class="flex justify-start pt-base">';
      html += '<button onclick="addLogicNode(\'' + id + '\')" class="w-full py-2 border-2 border-dashed border-outline-variant rounded-xl text-on-surface-variant font-label-sm text-label-sm hover:border-primary hover:text-primary transition-all flex items-center justify-center gap-1">';
      html += '<span class="material-symbols-outlined text-[18px]">add</span>';
      html += '<span>Add Logic Step</span>';
      html += '</button>';
      html += '</div>';
      
      html += '</div>';
      return html;
    }