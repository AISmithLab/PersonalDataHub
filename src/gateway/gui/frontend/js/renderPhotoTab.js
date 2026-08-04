function renderPhotoTab() {
      var photoFilters = (state.filters || []).filter(function(f) { return f.source === 'photo'; });
      var activeFilterCount = photoFilters.filter(function(f) { return f.enabled; }).length;

      var photosList = state.photo && state.photo.photos ? state.photo.photos : [
        { id: 'img-1', title: 'Receipt_Lunch.jpg', album: 'Receipts', date: '2026-07-28T12:00:00Z', width: 4032, height: 3024 },
        { id: 'img-2', title: 'Screenshot_Flight.png', album: 'Screenshots', date: '2026-07-27T15:30:00Z', width: 1080, height: 2400 },
        { id: 'img-3', title: 'Whiteboard_Notes.jpg', album: 'Work', date: '2026-07-25T09:15:00Z', width: 3024, height: 4032 },
        { id: 'img-4', title: 'Expense_Report.jpg', album: 'Receipts', date: '2026-07-24T18:45:00Z', width: 4032, height: 3024 }
      ];

      var html = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="status-dot status-dot-connected"></span>
              <h1 style="font-size:24px;font-weight:700;letter-spacing:-0.5px;color:var(--fg)">Device Photos & Gallery</h1>
            </div>
            <p style="font-size:14px;color:var(--muted);margin-top:4px">Zero access by default. Automatically strips EXIF GPS coordinates, camera serial numbers, and identifiable info.</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge badge-connected" style="padding:4px 10px;font-size:12px">Bridge Connected</span>
          </div>
        </div>

        ${state.photo && state.photo.error ? `
        <div style="background:var(--card);border:1px solid #f87171;border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:20px">⚠️</span>
            <div>
              <div style="font-weight:600;color:#ef4444">Photo Permission Required</div>
              <div style="font-size:13px;color:var(--muted)">Android permission was denied (${escapeAttr(String(state.photo.error))}). Please grant photo/media access in Android Settings.</div>
            </div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="loadPhotos(true)">Retry Permission</button>
        </div>` : ''}

        <div class="card" style="padding:20px;margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <label style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.8px">Photo Quick Filters (${activeFilterCount} active)</label>
            <span style="font-size:12px;color:var(--primary);font-weight:600">EXIF Protection ON by Default</span>
          </div>
          ${renderFilterCards(photoFilters, 'photo')}
        </div>

        <div class="card" style="padding:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div>
              <h2 style="font-size:16px;font-weight:700;margin:0">Gallery Preview (EXIF Stripped)</h2>
              <p style="font-size:12px;color:var(--muted);margin-top:2px">What AI agents see when querying your photos with active filters</p>
            </div>
            <button class="btn btn-outline btn-sm" onclick="if(window.AndroidSms&&window.AndroidSms.getPhotos){loadPhotos(true)}else{alert('Real device gallery access requires running on Android/iOS mobile App.')}">Refresh Gallery</button>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">
      `;

      photosList.forEach(function(p) {
        var dateStr = p.date ? new Date(p.date).toLocaleDateString() : '';
        html += `
          <div style="border:1px solid var(--border);border-radius:12px;padding:12px;background:#fff;display:flex;flex-direction:column;justify-content:space-between">
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span class="badge" style="background:rgba(15,160,129,0.1);color:var(--primary);font-size:11px;font-weight:600">${escapeHtml(p.album || 'Gallery')}</span>
                <span style="font-size:11px;color:var(--muted);font-family:monospace">EXIF STRIPPED</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer" onclick="previewPhoto('${p.id}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary)"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                <span style="font-size:14px;font-weight:600;color:var(--fg);word-break:break-all;text-decoration:underline;text-decoration-color:rgba(0,0,0,0.2)">${escapeHtml(p.title || 'Photo')}</span>
              </div>
              <div style="font-size:12px;color:var(--muted)">Dimensions: ${p.width || 4032} &times; ${p.height || 3024}</div>
              <div style="font-size:12px;color:var(--muted)">Date: ${escapeHtml(dateStr)}</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
              <button class="btn btn-sm btn-outline" style="flex:1;font-size:12px" onclick="previewPhoto('${p.id}')">Preview</button>
              <button class="btn btn-sm btn-primary" style="flex:1;font-size:12px" onclick="injectDemoQuestion('Analyze screenshot ${escapeAttr(p.title)}')">AI Inspect</button>
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;

      return html;
    }
    window.renderPhotoTab = renderPhotoTab;
