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

      // Collapsed disclosures for run_code tool calls
      toolOutputs.forEach(function(to) {
        if (to.name !== 'run_code') return;
        var parsed = null;
        try { parsed = JSON.parse(to.output); } catch(_) {}
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