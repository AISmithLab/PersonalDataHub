function renderCalendarFilterCards(filters) {
      var types = state.filterTypes || {};
      var typeKeys = Object.keys(types).filter(function(k) { return k === 'time_after'; }); // Only time_after for calendar for now
      if (!typeKeys.length) return '<p class="empty">Loading filter types...</p>';

      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">';
      typeKeys.forEach(function(typeKey) {
        var meta = types[typeKey];
        var label = meta.label;
        if (typeKey === 'time_after') label = 'Only events after';

        var existing = filters.find(function(f) { return f.type === typeKey; });
        var isEnabled = existing ? !!existing.enabled : false;
        var value = existing ? (existing.value || '') : '';
        var filterId = existing ? existing.id : '';
        var safeType = escapeAttr(typeKey);
        var needsValue = meta.needsValue;

        html += '<div class="card" style="padding:14px;margin:0;border:1px solid ' + (isEnabled ? 'rgba(15,160,129,0.3)' : 'var(--border)') + ';transition:border-color 0.2s">';
        html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:' + (needsValue ? '10px' : '0') + '">';
        html += '<label style="position:relative;display:inline-block;width:36px;height:20px;margin:0;cursor:pointer;flex-shrink:0">';
        html += '<input type="checkbox" ' + (isEnabled ? 'checked' : '') + ' onchange="toggleCalendarFilter(&quot;' + safeType + '&quot;, this.checked, &quot;' + escapeAttr(filterId) + '&quot;)" style="opacity:0;width:0;height:0">';
        html += '<span style="position:absolute;inset:0;background:' + (isEnabled ? 'var(--primary)' : '#ccc') + ';border-radius:10px;transition:background 0.2s"></span>';
        html += '<span style="position:absolute;left:' + (isEnabled ? '18px' : '2px') + ';top:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>';
        html += '</label>';
        html += '<span style="font-size:14px;font-weight:500;color:' + (isEnabled ? 'var(--fg)' : 'var(--muted)') + '">' + escapeHtml(label) + '</span>';
        html += '</div>';
        if (needsValue) {
          html += '<input type="' + (typeKey === 'time_after' ? 'date' : 'text') + '" id="cal-filter-val-' + safeType + '" value="' + escapeAttr(value) + '" placeholder="' + escapeAttr(meta.placeholder) + '" onchange="updateCalendarFilterValue(&quot;' + safeType + '&quot;, this.value, &quot;' + escapeAttr(filterId) + '&quot;)" style="width:100%;font-size:13px;padding:6px 10px">';
        }
        html += '</div>';
      });
      html += '</div>';
      return html;
    }