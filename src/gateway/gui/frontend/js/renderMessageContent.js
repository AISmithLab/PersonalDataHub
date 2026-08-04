function renderPhotoCard(photos) {
      if (!Array.isArray(photos) || !photos.length) return '<div class="text-xs text-muted py-1">No photos matched.</div>';
      window._photoCache = window._photoCache || {};
      var html = '<div class="my-2 p-3 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm">';
      html += '<div class="flex items-center justify-between mb-2"><span class="font-label-sm text-label-sm font-semibold text-on-surface">Gallery Photos (' + photos.length + ')</span><span class="text-xs text-primary font-mono">EXIF Stripped</span></div>';
      html += '<div class="grid grid-cols-2 gap-2">';
      photos.slice(0, 4).forEach(function(p) {
        var id = p.id || 'img-1';
        window._photoCache[id] = p;
        var title = p.title || 'Photo';
        var album = p.album || 'Gallery';
        var dateStr = p.date ? new Date(p.date).toLocaleDateString() : '';
        var imgSrc = p.dataUrl || p.uri || '';
        var thumbHtml = imgSrc
          ? '<div class="w-full h-24 mb-2 bg-surface-container-low rounded overflow-hidden flex items-center justify-center"><img src="' + escapeAttr(imgSrc) + '" class="w-full h-full object-cover" alt="' + escapeAttr(title) + '" /></div>'
          : '<div class="w-full h-24 mb-2 bg-surface-container-low rounded overflow-hidden flex items-center justify-center text-primary"><span class="material-symbols-outlined text-3xl">image</span></div>';
        html += '<div class="p-2 bg-white border border-outline-variant rounded-lg flex flex-col justify-between">';
        html += '<div>' + thumbHtml + '<div class="flex items-center gap-1 text-primary mb-1"><span class="font-label-sm text-xs font-medium truncate" title="' + escapeAttr(title) + '">' + escapeHtml(title) + '</span></div>';
        html += '<div class="text-[11px] text-muted flex items-center justify-between"><span>' + escapeHtml(album) + '</span><span>' + escapeHtml(dateStr) + '</span></div></div>';
        html += '<div class="flex gap-1 mt-2 pt-1 border-t border-outline-variant/40">';
        html += '<button class="flex-1 py-1 text-[11px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 rounded text-center transition-colors" onclick="previewPhoto(\'' + escapeAttr(String(id)) + '\')">&#128065; Preview</button>';
        html += '<button class="flex-1 py-1 text-[11px] font-semibold text-on-surface bg-surface-container hover:bg-surface-container-high rounded text-center transition-colors" onclick="injectDemoQuestion(\'Share photo ' + escapeAttr(title) + '\')">&#128228; Share</button>';
        html += '</div></div>';
      });
      html += '</div></div>';
      return html;
    }

    function renderEmailCard(emails) {
      if (!Array.isArray(emails) || !emails.length) return '<div class="text-xs text-muted py-1">No emails matched.</div>';
      var html = '<div class="my-2 space-y-2">';
      emails.slice(0, 3).forEach(function(e) {
        var fromStr = e.from || 'Unknown';
        var initials = fromStr.charAt(0).toUpperCase();
        var dateStr = e.date ? new Date(e.date).toLocaleDateString() : '';
        html += '<div class="p-3 bg-white border border-outline-variant rounded-xl shadow-sm space-y-1">';
        html += '<div class="flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center">' + initials + '</div><span class="font-label-sm text-xs font-semibold text-on-surface truncate max-w-[160px]">' + escapeHtml(fromStr) + '</span></div><span class="text-[11px] text-muted">' + escapeHtml(dateStr) + '</span></div>';
        html += '<div class="font-label-sm text-xs font-bold text-on-surface">' + escapeHtml(e.subject || '(no subject)') + '</div>';
        html += '<p class="text-xs text-on-surface-variant line-clamp-2 leading-relaxed">' + escapeHtml(e.snippet || '') + '</p>';
        html += '</div>';
      });
      html += '</div>';
      return html;
    }

    function renderStagedDraftCard(input) {
      var to = input.to || '';
      var subject = input.subject || '';
      var body = input.body || '';
      var html = '<div class="my-2 p-3 bg-primary/5 border border-primary/30 rounded-xl shadow-sm space-y-2">';
      html += '<div class="font-label-sm text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1"><span class="material-symbols-outlined text-sm">edit_square</span> Staged Email Reply</div>';
      html += '<div class="space-y-1"><label class="text-[11px] font-semibold text-muted">To:</label><input type="text" value="' + escapeAttr(to) + '" class="w-full text-xs p-1.5 border border-outline-variant rounded bg-white" readonly></div>';
      html += '<div class="space-y-1"><label class="text-[11px] font-semibold text-muted">Subject:</label><input type="text" value="' + escapeAttr(subject) + '" class="w-full text-xs p-1.5 border border-outline-variant rounded bg-white" readonly></div>';
      html += '<div class="space-y-1"><label class="text-[11px] font-semibold text-muted">Body:</label><textarea class="w-full text-xs p-1.5 border border-outline-variant rounded bg-white h-20" readonly>' + escapeHtml(body) + '</textarea></div>';
      html += '<div class="flex gap-2 pt-1">';
      html += '<button class="flex-1 py-1.5 text-xs font-semibold text-error border border-error/30 hover:bg-error/10 rounded-lg transition-colors" onclick="alert(\'Draft denied\')">&#10060; Deny</button>';
      html += '<button class="flex-1 py-1.5 text-xs font-semibold text-on-surface bg-surface-container hover:bg-surface-container-high rounded-lg transition-colors" onclick="alert(\'Saved to Gmail Drafts\')">&#128190; Save Draft</button>';
      html += '<button class="flex-1 py-1.5 text-xs font-semibold text-on-primary bg-primary hover:bg-primary-hover rounded-lg transition-colors shadow-sm" onclick="alert(\'Approved and sent!\')">&#128640; Approve & Send</button>';
      html += '</div></div>';
      return html;
    }

    function renderMessageContent(msg) {
      var content = msg.content || '';
      var toolOutputs = msg.toolOutputs || [];
      var html = '';

      // Split on fenced code blocks (triple-backtick lang newline code triple-backtick)
      var codeRe = /```(\w*)\n?([\s\S]*?)```/g;
      var lastIndex = 0;
      var match;
      while ((match = codeRe.exec(content)) !== null) {
        // Text before this block
        if (match.index > lastIndex) {
          html += '<span style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(content.slice(lastIndex, match.index)) + '</span>';
        }
        // Store code under a unique ID so we avoid injecting it into onclick attributes
        var blockId = 'cb_' + Math.random().toString(36).slice(2, 10);
        state.chat.codeBlocks[blockId] = match[2];
        var lang = match[1] || 'js';
        html += '<div style="margin:6px 0;border-radius:8px;overflow:hidden;border:1px solid rgba(0,0,0,0.12)">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:rgba(0,0,0,0.06);font-size:11px;color:var(--muted)">';
        html += '<span style="font-family:JetBrains Mono,monospace">' + escapeHtml(lang) + '</span>';
        html += '<button class="btn btn-sm" onclick="runCodeBlock(this,\'' + blockId + '\')" style="padding:3px 10px;font-size:11px;background:var(--primary);color:#fff;border:none">&#9654; Run</button>';
        html += '</div>';
        html += '<pre style="margin:0;padding:10px;background:rgba(0,0,0,0.03);overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5"><code>' + escapeHtml(match[2]) + '</code></pre>';
        html += '<div class="code-output-slot" style="display:none"></div>';
        html += '</div>';
        lastIndex = codeRe.lastIndex;
      }
      // Remaining text after last code block
      if (lastIndex < content.length) {
        html += '<span style="white-space:pre-wrap;word-break:break-word">' + escapeHtml(content.slice(lastIndex)) + '</span>';
      }

      // Format tool outputs & interactive cards
      toolOutputs.forEach(function(to) {
        var parsed = null;
        try { parsed = JSON.parse(to.output); } catch(_) {}

        if (to.name === 'read_photos') {
          html += renderPhotoCard(parsed);
          return;
        }
        if (to.name === 'read_emails') {
          html += renderEmailCard(parsed);
          return;
        }
        if (to.name === 'draft_email') {
          html += renderStagedDraftCard(to.input || {});
          return;
        }

        if (to.name !== 'run_code') return;
        var output = parsed ? (parsed.output || '(no output)') : to.output;
        var hasError = parsed && parsed.error;
        var durationMs = parsed && parsed.duration_ms ? parsed.duration_ms + 'ms' : '';
        var code = to.input && to.input.code ? String(to.input.code) : '';
        html += '<details style="margin-top:6px">';
        html += '<summary style="cursor:pointer;font-size:11px;color:var(--muted);padding:3px 0;list-style:none;display:flex;align-items:center;gap:4px">';
        html += '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        html += 'Code ran' + (durationMs ? ' &middot; ' + durationMs : '') + (hasError ? ' &middot; error' : '') + '</summary>';
        if (code) {
          html += '<pre style="margin:4px 0 0;padding:8px;background:rgba(0,0,0,0.06);border-radius:6px 6px 0 0;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;color:var(--fg)">' + escapeHtml(code) + '</pre>';
          html += '<pre style="margin:0;padding:8px;background:rgba(0,0,0,0.03);border-radius:0 0 6px 6px;border-top:1px solid rgba(0,0,0,0.08);overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;color:' + (hasError ? 'var(--destructive)' : 'var(--muted)') + '">' + escapeHtml(output + (hasError ? '\n[error] ' + parsed.error : '')) + '</pre>';
        } else {
          html += '<pre style="margin:4px 0 0;padding:8px;background:rgba(0,0,0,0.04);border-radius:6px;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;line-height:1.5;color:' + (hasError ? 'var(--destructive)' : 'var(--fg)') + '">' + escapeHtml(output + (hasError ? '\n[error] ' + parsed.error : '')) + '</pre>';
        }
        html += '</details>';
      });

      return html;
    }