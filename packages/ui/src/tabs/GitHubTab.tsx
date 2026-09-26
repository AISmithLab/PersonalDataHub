import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, Switch, Linking } from 'react-native';
import type { AppState } from '../hooks/useAppState';
import { oauthStartUrl, type GithubRepo } from '../api/client';

const PERM_GROUPS: { label: string; read: string; write: string }[] = [
  { label: 'Contents', read: 'contents:read', write: 'contents:write' },
  { label: 'Issues', read: 'issues:read', write: 'issues:write' },
  { label: 'Pull Requests', read: 'pull_requests:read', write: 'pull_requests:write' },
];

function permsOf(repo: GithubRepo): string[] {
  return typeof repo.permissions === 'string' ? JSON.parse(repo.permissions) : repo.permissions;
}

export function GitHubTab({ state }: { state: AppState }) {
  const github = state.sources.find((s) => s.name === 'github');
  const ghConnected = !!github?.connected;
  const ghLogin = github?.accountInfo?.login;
  const allRepos = state.repos ?? [];

  const [filterOwner, setFilterOwner] = useState('');
  const [search, setSearch] = useState('');
  const [bulkPerms, setBulkPerms] = useState<Set<string>>(
    new Set(['contents:read', 'issues:read', 'pull_requests:read'])
  );

  const allOwners = useMemo(() => {
    const seen = new Map<string, boolean>();
    allRepos.forEach((r) => {
      if (!seen.has(r.owner)) seen.set(r.owner, r.is_org);
    });
    return [...seen.entries()]
      .map(([name, is_org]) => ({ name, is_org }))
      .sort((a, b) => (a.is_org !== b.is_org ? (a.is_org ? 1 : -1) : a.name.localeCompare(b.name)));
  }, [allRepos]);

  const filtered = useMemo(() => {
    let list = allRepos;
    if (filterOwner) list = list.filter((r) => r.owner === filterOwner);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) => r.full_name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [allRepos, filterOwner, search]);

  const groups = useMemo(() => {
    const g = new Map<string, GithubRepo[]>();
    filtered.forEach((r) => {
      if (!g.has(r.owner)) g.set(r.owner, []);
      g.get(r.owner)!.push(r);
    });
    return [...g.entries()].sort(([aOwner, aRepos], [bOwner, bRepos]) => {
      const aIsOrg = aRepos[0].is_org;
      const bIsOrg = bRepos[0].is_org;
      return aIsOrg !== bIsOrg ? (aIsOrg ? 1 : -1) : aOwner.localeCompare(bOwner);
    });
  }, [filtered]);

  if (!ghConnected) {
    return (
      <View className="max-w-[480px] mt-16 mx-auto items-center">
        <Text className="text-headline-md text-on-surface font-bold mb-2">GitHub</Text>
        <Text className="text-body-sm text-on-surface-variant mb-6 text-center">
          {github?.enabled ? 'Not connected' : 'Not configured'}
        </Text>
        <Pressable
          onPress={() => Linking.openURL(oauthStartUrl('github'))}
          className="bg-primary rounded-lg px-4 py-2.5"
        >
          <Text className="text-on-primary font-label-caps text-label-caps">Connect GitHub</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <View className="flex-row items-start justify-between mb-6">
        <View>
          <Text className="text-headline-md text-on-surface font-bold">GitHub</Text>
          {ghLogin ? <Text className="text-body-sm text-on-surface-variant mt-0.5">@{ghLogin}</Text> : null}
        </View>
        <Pressable
          onPress={() => state.disconnectSource('github')}
          className="border border-error/30 rounded-lg px-3 py-1.5"
        >
          <Text className="text-error text-label-sm">Disconnect</Text>
        </Pressable>
      </View>

      <View className="bg-surface rounded-lg border border-outline-variant p-5">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-label-sm text-on-surface-variant uppercase">Repositories</Text>
          <Pressable onPress={state.refreshRepos} className="border border-outline-variant rounded px-2.5 py-1">
            <Text className="text-label-sm text-on-surface-variant">Refresh repos</Text>
          </Pressable>
        </View>

        <View className="flex-row flex-wrap items-center gap-3 bg-surface-container-low rounded p-3 mb-3">
          {PERM_GROUPS.map((g) => (
            <View key={g.label} className="flex-row items-center gap-2">
              <Text className="text-label-sm font-semibold text-on-surface">{g.label}</Text>
              {[g.read, g.write].map((perm) => (
                <View key={perm} className="flex-row items-center gap-1">
                  <Switch
                    value={bulkPerms.has(perm)}
                    onValueChange={(next) =>
                      setBulkPerms((cur) => {
                        const nextSet = new Set(cur);
                        if (next) nextSet.add(perm);
                        else nextSet.delete(perm);
                        return nextSet;
                      })
                    }
                  />
                  <Text className="text-label-sm text-on-surface-variant">{perm.endsWith('write') ? 'write' : 'read'}</Text>
                </View>
              ))}
            </View>
          ))}
          <Pressable
            onPress={() => state.applyBulkPerms([...bulkPerms])}
            className="bg-primary rounded px-2.5 py-1 ml-auto"
          >
            <Text className="text-label-sm text-on-primary">Apply to selected</Text>
          </Pressable>
        </View>

        <View className="flex-row items-center gap-2 mb-3">
          <View className="border border-outline-variant rounded flex-1">
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search repos..."
              className="px-2.5 py-1.5 text-body-sm"
            />
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2 mb-3">
          <Pressable
            onPress={() => setFilterOwner('')}
            className={`rounded px-2.5 py-1 border ${!filterOwner ? 'bg-primary border-primary' : 'border-outline-variant'}`}
          >
            <Text className={`text-label-sm ${!filterOwner ? 'text-on-primary' : 'text-on-surface-variant'}`}>All accounts</Text>
          </Pressable>
          {allOwners.map((o) => (
            <Pressable
              key={o.name}
              onPress={() => setFilterOwner(o.name)}
              className={`rounded px-2.5 py-1 border ${filterOwner === o.name ? 'bg-primary border-primary' : 'border-outline-variant'}`}
            >
              <Text className={`text-label-sm ${filterOwner === o.name ? 'text-on-primary' : 'text-on-surface-variant'}`}>
                {o.name}
                {o.is_org ? ' (org)' : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        {state.reposLoading ? (
          <Text className="text-on-surface-variant text-body-sm text-center p-10">Loading repositories from GitHub...</Text>
        ) : !allRepos.length ? (
          <Text className="text-on-surface-variant text-body-sm text-center p-10">No repositories found. Tap "Refresh repos" to fetch.</Text>
        ) : !filtered.length ? (
          <Text className="text-on-surface-variant text-body-sm text-center p-10">No repositories match your filter.</Text>
        ) : (
          groups.map(([owner, ownerRepos]) => (
            <OwnerGroup key={owner} owner={owner} repos={ownerRepos} state={state} />
          ))
        )}
      </View>
    </View>
  );
}

function OwnerGroup({ owner, repos, state }: { owner: string; repos: GithubRepo[]; state: AppState }) {
  const isOrg = repos[0].is_org;
  const enabledCount = repos.filter((r) => r.enabled).length;

  return (
    <View className="mb-4">
      <View className="flex-row items-center gap-2 mb-2">
        <Text className="text-body-sm font-semibold text-on-surface">{owner}</Text>
        <View className={`rounded px-1.5 py-0.5 ${isOrg ? 'bg-warning/20' : 'bg-primary/20'}`}>
          <Text className="text-label-sm text-on-surface-variant">{isOrg ? 'org' : 'personal'}</Text>
        </View>
        <Text className="text-label-sm text-on-surface-variant">{enabledCount}/{repos.length} selected</Text>
        <Pressable onPress={() => state.selectAllOwner(owner, true)}>
          <Text className="text-label-sm text-primary">all</Text>
        </Pressable>
        <Pressable onPress={() => state.selectAllOwner(owner, false)}>
          <Text className="text-label-sm text-primary">none</Text>
        </Pressable>
      </View>
      {repos.map((repo) => (
        <RepoRow key={repo.full_name} repo={repo} state={state} />
      ))}
    </View>
  );
}

function RepoRow({ repo, state }: { repo: GithubRepo; state: AppState }) {
  const perms = permsOf(repo);
  const expanded = !!state.expandedRepos[repo.full_name];

  return (
    <View className="border border-outline-variant rounded-lg mb-1.5 overflow-hidden">
      <Pressable
        onPress={() => state.toggleExpandedRepo(repo.full_name)}
        className="flex-row items-center gap-2 px-3 py-2"
      >
        <Switch
          value={!!repo.enabled}
          onValueChange={(next) => state.toggleRepoEnabled(repo.full_name, next)}
        />
        <Text className="text-body-sm text-on-surface">{repo.name}</Text>
        {repo.private ? (
          <View className="bg-surface-container rounded px-1.5 py-0.5">
            <Text className="text-label-sm text-on-surface-variant">private</Text>
          </View>
        ) : null}
        {repo.description ? (
          <Text className="text-label-sm text-on-surface-variant flex-1" numberOfLines={1}>
            {repo.description}
          </Text>
        ) : null}
        <Text className="text-on-surface-variant">{expanded ? '▼' : '▶'}</Text>
      </Pressable>
      {expanded && (
        <View className="flex-row flex-wrap items-center gap-3 px-3 py-2 border-t border-outline-variant bg-surface-container-low">
          {PERM_GROUPS.map((g) => (
            <View key={g.label} className="flex-row items-center gap-2">
              <Text className="text-label-sm font-semibold text-on-surface">{g.label}</Text>
              {[g.read, g.write].map((perm) => (
                <View key={perm} className="flex-row items-center gap-1">
                  <Switch
                    value={perms.includes(perm)}
                    onValueChange={(next) => state.toggleRepoPerm(repo.full_name, perm, next)}
                  />
                  <Text className="text-label-sm text-on-surface-variant">{perm.endsWith('write') ? 'write' : 'read'}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
