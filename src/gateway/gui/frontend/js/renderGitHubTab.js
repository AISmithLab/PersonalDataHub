function renderGitHubTab() {
      var github = state.sources.find(function(s) { return s.name === 'github'; });
      var ghConnected = github && github.connected;
      var ghAccount = github && github.accountInfo;
      var allRepos = state.github.repoList || [];

      // Auto-fetch repos on first render when connected
      if (ghConnected && !state.github.reposLoaded && !state.github.reposLoading) {
        fetchGithubRepos();
      }

      // Collect all unique owners for the dropdown
      var allOwners = [];
      var ownerSeen = {};
      allRepos.forEach(function(r) {
        if (!ownerSeen[r.owner]) { ownerSeen[r.owner] = true; allOwners.push({ name: r.owner, is_org: r.is_org }); }
      });
      allOwners.sort(function(a, b) {
        if (a.is_org !== b.is_org) return a.is_org ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

      // Filter repos by owner and search
      var filtered = allRepos;
      if (state.github.filterOwner) {
        filtered = filtered.filter(function(r) { return r.owner === state.github.filterOwner; });
      }
      if (state.github.search) {
        var q = state.github.search.toLowerCase();
        filtered = filtered.filter(function(r) {
          return r.full_name.toLowerCase().indexOf(q) !== -1 || (r.description && r.description.toLowerCase().indexOf(q) !== -1);
        });
      }

      // Group filtered repos by owner
      var groups = {};
      filtered.forEach(function(r) {
        if (!groups[r.owner]) groups[r.owner] = [];
        groups[r.owner].push(r);
      });
      var ownerKeys = Object.keys(groups).sort();
      ownerKeys.sort(function(a, b) {
        var aIsOrg = groups[a][0].is_org;
        var bIsOrg = groups[b][0].is_org;
        if (aIsOrg !== bIsOrg) return aIsOrg ? 1 : -1;
        return a.localeCompare(b);
      });

      var repoHtml = '';
      if (state.github.reposLoading) {
        repoHtml = '<p class="empty" style="display:flex;align-items:center;justify-content:center;gap:8px"><span class="spinner"></span> Loading repositories from GitHub...</p>';
      } else if (ghConnected && !allRepos.length) {
        repoHtml = '<p class="empty">No repositories found. Click "Refresh repos" to fetch.</p>';
      } else if (ghConnected && !filtered.length) {
        repoHtml = '<p class="empty">No repositories match your filter.</p>';
      } else if (ghConnected) {
        ownerKeys.forEach(function(owner) {
          var ownerRepos = groups[owner];
          var isOrg = ownerRepos[0].is_org;
          var enabledCount = ownerRepos.filter(function(r) { return r.enabled; }).length;
          repoHtml += '<div style="margin-bottom:16px">';
          repoHtml += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
          repoHtml += '<h3 style="font-size:14px;margin:0">' + escapeHtml(owner) + '</h3>';
          repoHtml += '<span class="status ' + (isOrg ? 'pending' : 'connected') + '">' + (isOrg ? 'org' : 'personal') + '</span>';
          repoHtml += '<span style="font-size:14px;color:#888">' + enabledCount + '/' + ownerRepos.length + ' selected</span>';
          repoHtml += '<span class="sel-links">(<a onclick="selectAllOwner(\'' + escapeAttr(owner) + '\', true)">all</a> / <a onclick="selectAllOwner(\'' + escapeAttr(owner) + '\', false)">none</a>)</span>';
          repoHtml += '</div>';

          ownerRepos.forEach(function(repo) {
            var perms = typeof repo.permissions === 'string' ? JSON.parse(repo.permissions) : repo.permissions;
            var hasCodeRead = perms.indexOf('contents:read') !== -1;
            var hasCodeWrite = perms.indexOf('contents:write') !== -1;
            var hasIssuesRead = perms.indexOf('issues:read') !== -1;
            var hasIssuesWrite = perms.indexOf('issues:write') !== -1;
            var hasPrsRead = perms.indexOf('pull_requests:read') !== -1;
            var hasPrsWrite = perms.indexOf('pull_requests:write') !== -1;
            var exp = state.expandedRepos[repo.full_name];
            var safe = repo.full_name.replace(/'/g, "\\'");
            repoHtml += '<div class="repo-item">';
            repoHtml += '<div class="repo-header" onclick="toggleRepo(\'' + safe + '\')">';
            repoHtml += '<input type="checkbox" ' + chk(repo.enabled) + ' onclick="event.stopPropagation(); toggleRepoEnabled(\'' + safe + '\', this.checked)" title="Enable access">';
            repoHtml += '<span class="repo-name">' + escapeHtml(repo.name) + '</span>';
            if (repo.private) repoHtml += '<span class="status disconnected" style="font-size:14px;padding:2px 6px">private</span>';
            if (repo.description) repoHtml += '<span style="font-size:14px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px">' + escapeHtml(repo.description) + '</span>';
            repoHtml += '<span class="repo-chevron ' + (exp ? 'open' : '') + '">&#9654;</span>';
            repoHtml += '</div>';
            repoHtml += '<div class="repo-perms ' + (exp ? 'show' : '') + '">';
            repoHtml += '<div style="display:flex;align-items:center;gap:6px;padding:8px 0">';
            repoHtml += '<span style="font-size:14px;font-weight:700;color:var(--fg)">Contents</span>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasCodeRead) + ' onchange="toggleRepoPerm(\'' + safe + '\', \'contents:read\', this.checked)"><label>read</label></div>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasCodeWrite) + ' onchange="toggleRepoPerm(\'' + safe + '\', \'contents:write\', this.checked)"><label>write</label></div>';
            repoHtml += '<span style="color:#ddd;margin:0 4px">|</span>';
            repoHtml += '<span style="font-size:14px;font-weight:700;color:var(--fg)">Issues</span>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasIssuesRead) + ' onchange="toggleRepoPerm(\'' + safe + '\', \'issues:read\', this.checked)"><label>read</label></div>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasIssuesWrite) + ' onchange="toggleRepoPerm(\'' + safe + '\', \'issues:write\', this.checked)"><label>write</label></div>';
            repoHtml += '<span style="color:#ddd;margin:0 4px">|</span>';
            repoHtml += '<span style="font-size:14px;font-weight:700;color:var(--fg)">Pull Requests</span>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasPrsRead) + ' onchange="toggleRepoPerm(\'' + safe + '\', \'pull_requests:read\', this.checked)"><label>read</label></div>';
            repoHtml += '<div class="toggle" style="margin:0"><input type="checkbox" ' + chk(hasPrsWrite) + ' onchange="toggleRepoPerm(\'' + safe + '\', \'pull_requests:write\', this.checked)"><label>write</label></div>';
            repoHtml += '</div></div></div>';
          });
          repoHtml += '</div>';
        });
      }

      // Build owner select options
      var ownerOptions = '<option value="">All accounts</option>';
      allOwners.forEach(function(o) {
        ownerOptions += '<option value="' + escapeAttr(o.name) + '"' + (state.github.filterOwner === o.name ? ' selected' : '') + '>' + escapeHtml(o.name) + (o.is_org ? ' (org)' : '') + '</option>';
      });

      return `
        <div class="card">
          <h2>Connection Status</h2>
          ${ghConnected
            ? '<div style="display:flex;align-items:center;gap:10px"><span class="status-dot status-dot-connected"></span><span class="status connected">Connected</span></div>' +
              (ghAccount && ghAccount.login ? '<p style="margin-top:8px;font-size:14px">Signed in as <strong class="font-mono">@' + ghAccount.login + '</strong></p>' : '') +
              '<div class="actions"><button class="btn btn-danger btn-sm" onclick="disconnectSource(\'github\')">Disconnect</button></div>'
            : '<div style="display:flex;align-items:center;gap:10px"><span class="status-dot status-dot-disconnected"></span><span class="status disconnected">' + (github?.enabled ? 'Not connected' : 'Not configured') + '</span></div>' +
              '<div class="actions"><button class="btn btn-primary" onclick="startOAuth(\'github\')">Connect GitHub</button></div>'
          }
        </div>

        ${ghConnected ? '<div class="card"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Repositories <span class="save-flash" id="github-flash">Saved</span></h2><button class="btn btn-outline btn-sm" onclick="fetchGithubRepos()">Refresh repos</button></div>' +
          '<div style="display:flex;align-items:center;gap:6px;padding:10px 14px;background:var(--sidebar-bg);border-radius:6px;margin-bottom:12px">' +
            '<span style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">Contents</span>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-code-read" checked><label for="bulk-code-read" style="font-size:14px">read</label></div>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-code-write"><label for="bulk-code-write" style="font-size:14px">write</label></div>' +
            '<span style="color:#ddd;margin:0 4px">|</span>' +
            '<span style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">Issues</span>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-issues-read" checked><label for="bulk-issues-read" style="font-size:14px">read</label></div>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-issues-write"><label for="bulk-issues-write" style="font-size:14px">write</label></div>' +
            '<span style="color:#ddd;margin:0 4px">|</span>' +
            '<span style="font-size:14px;font-weight:700;color:var(--fg);white-space:nowrap">Pull Requests</span>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-prs-read" checked><label for="bulk-prs-read" style="font-size:14px">read</label></div>' +
            '<div class="toggle" style="margin:0"><input type="checkbox" id="bulk-prs-write"><label for="bulk-prs-write" style="font-size:14px">write</label></div>' +
            '<span style="flex:1"></span>' +
            '<button class="btn btn-primary btn-sm" onclick="applyBulkPerms()">Apply to selected</button>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
            '<select style="width:auto;min-width:140px" onchange="state.github.filterOwner=this.value; render()">' + ownerOptions + '</select>' +
            '<input type="text" id="gh-repo-search" placeholder="Search repos..." value="' + escapeAttr(state.github.search) + '" oninput="state.github.search=this.value; render()" style="flex:1">' +
          '</div>' +
          repoHtml + '</div>' : ''}
      `;
    }