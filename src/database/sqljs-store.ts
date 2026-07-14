/**
 * SqlJsDataStore — DataStore implementation backed by sql.js (pure-JS SQLite).
 *
 * Used for Android (Node.js Mobile) where better-sqlite3 native bindings
 * are unavailable. The database is kept in memory and persisted to disk
 * via a debounced write after every mutation.
 *
 * sql.js API differs from better-sqlite3:
 *   - Statements use stmt.step() + stmt.getAsObject() rather than .get()
 *   - The database must be exported (Uint8Array) and written to disk manually
 *   - Initialization is async (WASM load)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// Minimal shape of sql.js types — avoids importing from 'sql.js' at compile time
// so the TypeScript build succeeds before `npm install` adds the package.
interface SqlJsStatement {
  bind(params: (string | number | null | Uint8Array)[]): void;
  step(): boolean;
  getAsObject(): Record<string, string | number | null | Uint8Array>;
  free(): void;
}
interface SqlJsDatabase {
  run(sql: string, params?: (string | number | null | Uint8Array)[]): void;
  exec(sql: string): void;
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
}
interface SqlJsStatic {
  Database: new (data?: Buffer | Uint8Array) => SqlJsDatabase;
}
import type {
  DataStore,
  StoredTokenRow,
  StagingRow,
  FilterRow,
  AuditRow,
  MemoryRow,
  SkillRow,
  GitHubRepoRow,
  GitHubRepoInput,
  OAuthStateData,
} from './datastore.js';
import { createTables } from './schema-sqljs.js';

export class SqlJsDataStore implements DataStore {
  private pendingStates = new Map<string, OAuthStateData>();

  private constructor(
    private readonly db: SqlJsDatabase,
    private readonly dbPath: string,
  ) {}

  static async create(dbPath: string): Promise<SqlJsDataStore> {
    // On Android (CJS bundle), SQLJS_WASM_PATH is set by android.ts before startup.
    // We derive the sql-wasm.js path from it and require() it by absolute path —
    // this avoids any __filename / module-resolution ambiguity inside esbuild bundles.
    // On desktop (no SQLJS_WASM_PATH), fall back to dynamic import from node_modules.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let initFactory: any;
    const wasmEnvPath = process.env.SQLJS_WASM_PATH;
    if (wasmEnvPath) {
      // sql-wasm.js lives alongside sql-wasm.wasm in the same dist/ directory.
      const sqlJsMainPath = wasmEnvPath.replace(/\.wasm$/, '.js');
      // createRequire needs an absolute base; since sqlJsMainPath is already absolute,
      // the base only needs to be any valid absolute path.
      const _req = createRequire('/index.js');
      initFactory = _req(sqlJsMainPath);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const importFn = new Function('id', 'return import(id)') as (id: string) => Promise<Record<string, unknown>>;
      const m = await importFn('sql.js');
      initFactory = m['default'] ?? m;
    }

    const SQL: SqlJsStatic = await initFactory(
      wasmEnvPath ? { locateFile: () => wasmEnvPath } : {},
    ) as SqlJsStatic;

    let db: SqlJsDatabase;
    if (existsSync(dbPath)) {
      const fileData = readFileSync(dbPath);
      db = new SQL.Database(fileData);
    } else {
      db = new SQL.Database();
    }

    const store = new SqlJsDataStore(db, dbPath);
    createTables(store);
    return store;
  }

  /** Execute one or more DDL statements (CREATE TABLE, etc.). */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  private run(sql: string, params: unknown[] = []): void {
    this.db.run(sql, params as (string | number | null | Uint8Array)[]);
    this.saveSync();
  }

  private getOne<T>(sql: string, params: unknown[] = []): T | null {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null | Uint8Array)[]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as T;
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  }

  private getAll<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as (string | number | null | Uint8Array)[]);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
  }

  private now(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }

  private saveSync(): void {
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  // --- Sessions ---

  getValidSession(token: string): { token: string } | null {
    return this.getOne<{ token: string }>(
      "SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')",
      [token],
    );
  }

  createSession(token: string, expiresAt: string): void {
    this.run('INSERT INTO sessions (token, expires_at) VALUES (?, ?)', [token, expiresAt]);
  }

  deleteSession(token: string): void {
    this.run('DELETE FROM sessions WHERE token = ?', [token]);
  }

  // --- Users ---

  getUserByEmail(email: string): { id: number; email: string; password_hash: string } | null {
    return this.getOne('SELECT id, email, password_hash FROM users WHERE email = ?', [email]);
  }

  createUser(email: string, passwordHash: string): void {
    this.run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash]);
  }

  getUserCount(): number {
    const row = this.getOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
    return row?.count ?? 0;
  }

  // --- OAuth Tokens ---

  upsertToken(source: string, fields: {
    access_token: string;
    refresh_token: string | null;
    token_type: string;
    expires_at: string | null;
    scopes: string;
    account_info: string;
  }): void {
    this.run(
      `INSERT INTO oauth_tokens (source, access_token, refresh_token, token_type, expires_at, scopes, account_info, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_type = excluded.token_type,
         expires_at = excluded.expires_at,
         scopes = excluded.scopes,
         account_info = excluded.account_info,
         updated_at = excluded.updated_at`,
      [source, fields.access_token, fields.refresh_token, fields.token_type,
       fields.expires_at, fields.scopes, fields.account_info, this.now()],
    );
  }

  getToken(source: string): StoredTokenRow | null {
    return this.getOne<StoredTokenRow>('SELECT * FROM oauth_tokens WHERE source = ?', [source]);
  }

  hasToken(source: string): boolean {
    return this.getOne('SELECT 1 as x FROM oauth_tokens WHERE source = ?', [source]) !== null;
  }

  getAccountInfo(source: string): string | null {
    const row = this.getOne<{ account_info: string }>('SELECT account_info FROM oauth_tokens WHERE source = ?', [source]);
    return row?.account_info ?? null;
  }

  updateAccountInfo(source: string, info: string): void {
    this.run('UPDATE oauth_tokens SET account_info = ?, updated_at = ? WHERE source = ?', [info, this.now(), source]);
  }

  deleteToken(source: string): void {
    this.run('DELETE FROM oauth_tokens WHERE source = ?', [source]);
  }

  getTokenExpiresAt(source: string): string | null {
    const row = this.getOne<{ expires_at: string | null }>('SELECT expires_at FROM oauth_tokens WHERE source = ?', [source]);
    return row?.expires_at ?? null;
  }

  updateAccessToken(source: string, accessToken: string, expiresAt: string | null): void {
    this.run('UPDATE oauth_tokens SET access_token = ?, expires_at = ?, updated_at = ? WHERE source = ?',
      [accessToken, expiresAt, this.now(), source]);
  }

  // --- Staging ---

  insertStagingAction(action: {
    actionId: string;
    manifestId: string;
    source: string;
    actionType: string;
    actionData: string;
    purpose: string;
  }): void {
    this.run(
      `INSERT INTO staging (action_id, manifest_id, source, action_type, action_data, purpose, status, proposed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [action.actionId, action.manifestId, action.source, action.actionType,
       action.actionData, action.purpose, this.now()],
    );
  }

  getStagingAction(actionId: string): StagingRow | null {
    return this.getOne<StagingRow>('SELECT * FROM staging WHERE action_id = ?', [actionId]);
  }

  getAllStagingActions(): StagingRow[] {
    return this.getAll<StagingRow>('SELECT * FROM staging ORDER BY proposed_at DESC');
  }

  updateStagingStatus(actionId: string, status: string): void {
    this.run('UPDATE staging SET status = ?, resolved_at = ? WHERE action_id = ?',
      [status, this.now(), actionId]);
  }

  updateStagingActionData(actionId: string, actionData: string): void {
    this.run('UPDATE staging SET action_data = ? WHERE action_id = ?', [actionData, actionId]);
  }

  // --- Filters ---

  getFiltersBySource(source: string): FilterRow[] {
    return this.getAll<FilterRow>('SELECT * FROM filters WHERE source = ? ORDER BY created_at DESC', [source]);
  }

  getAllFilters(): FilterRow[] {
    return this.getAll<FilterRow>('SELECT * FROM filters ORDER BY created_at DESC');
  }

  getEnabledFiltersBySource(source: string): FilterRow[] {
    return this.getAll<FilterRow>('SELECT * FROM filters WHERE source = ? AND enabled = 1', [source]);
  }

  createFilter(filter: { id: string; source: string; type: string; value: string; enabled: number }): void {
    this.run('INSERT INTO filters (id, source, type, value, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [filter.id, filter.source, filter.type, filter.value, filter.enabled, this.now()]);
  }

  updateFilter(id: string, value: string, enabled: number): void {
    this.run('UPDATE filters SET value = ?, enabled = ? WHERE id = ?', [value, enabled, id]);
  }

  deleteFilter(id: string): void {
    this.run('DELETE FROM filters WHERE id = ?', [id]);
  }

  // --- Audit Log ---

  insertAuditEntry(entry: { timestamp: string; event: string; source: string | null; details: string }): void {
    this.run('INSERT INTO audit_log (timestamp, event, source, details) VALUES (?, ?, ?, ?)',
      [entry.timestamp, entry.event, entry.source, entry.details]);
  }

  queryAuditEntries(filters: { after?: string; before?: string; event?: string; source?: string; limit?: number }): AuditRow[] {
    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params: unknown[] = [];

    if (filters.after)  { query += ' AND timestamp >= ?'; params.push(filters.after); }
    if (filters.before) { query += ' AND timestamp <= ?'; params.push(filters.before); }
    if (filters.event)  { query += ' AND event = ?';      params.push(filters.event); }
    if (filters.source) { query += ' AND source = ?';     params.push(filters.source); }

    query += ' ORDER BY id ASC';
    if (filters.limit)  { query += ' LIMIT ?'; params.push(filters.limit); }

    return this.getAll<AuditRow>(query, params);
  }

  deleteAllAuditEntries(): void {
    this.run('DELETE FROM audit_log');
  }

  // --- GitHub Repos ---

  upsertGitHubRepos(repos: GitHubRepoInput[]): void {
    for (const repo of repos) {
      this.run(
        `INSERT INTO github_repos (full_name, owner, name, private, description, is_org, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(full_name) DO UPDATE SET
           private = excluded.private,
           description = excluded.description,
           is_org = excluded.is_org,
           fetched_at = excluded.fetched_at`,
        [repo.full_name, repo.owner, repo.name, repo.isPrivate ? 1 : 0,
         repo.description, repo.isOrg ? 1 : 0, this.now()],
      );
    }
  }

  getAllGitHubRepos(): GitHubRepoRow[] {
    return this.getAll<GitHubRepoRow>('SELECT * FROM github_repos ORDER BY owner, name');
  }

  getEnabledGitHubRepos(): Array<{ full_name: string }> {
    return this.getAll<{ full_name: string }>('SELECT full_name FROM github_repos WHERE enabled = 1');
  }

  updateGitHubRepoSettings(updates: Array<{ full_name: string; enabled: boolean; permissions: string }>): void {
    for (const u of updates) {
      this.run('UPDATE github_repos SET enabled = ?, permissions = ? WHERE full_name = ?',
        [u.enabled ? 1 : 0, u.permissions, u.full_name]);
    }
  }

  // --- OAuth State (CSRF) ---

  setOAuthState(state: string, data: OAuthStateData): void {
    this.pendingStates.set(state, data);
  }

  getAndDeleteOAuthState(state: string): OAuthStateData | null {
    const data = this.pendingStates.get(state);
    if (!data) return null;
    this.pendingStates.delete(state);
    return data;
  }

  // --- AI Memories ---

  listMemories(): MemoryRow[] {
    return this.getAll<MemoryRow>('SELECT * FROM ai_memories ORDER BY created_at ASC');
  }

  insertMemory(id: string, content: string): void {
    this.run('INSERT INTO ai_memories (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [id, content, this.now(), this.now()]);
  }

  updateMemory(id: string, content: string): void {
    this.run('UPDATE ai_memories SET content = ?, updated_at = ? WHERE id = ?',
      [content, this.now(), id]);
  }

  deleteMemory(id: string): void {
    this.run('DELETE FROM ai_memories WHERE id = ?', [id]);
  }

  // --- Agent Skills ---

  listSkills(): SkillRow[] {
    return this.getAll<SkillRow>('SELECT * FROM agent_skills ORDER BY trigger_event ASC, created_at ASC');
  }

  insertSkill(skill: { id: string; name: string; instructions: string; trigger_event: string; enabled?: number; current_view?: string; logic_tree?: string; summary?: string; primitive_type?: string; label_tag?: string | null }): void {
    this.run('INSERT INTO agent_skills (id, name, instructions, trigger_event, enabled, current_view, logic_tree, summary, primitive_type, label_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [skill.id, skill.name, skill.instructions, skill.trigger_event, skill.enabled ?? 0, skill.current_view ?? 'SUMMARIZED', skill.logic_tree ?? '[]', skill.summary ?? '', skill.primitive_type ?? 'action', skill.label_tag ?? null, this.now(), this.now()]);
  }

  updateSkill(id: string, fields: { name?: string; instructions?: string; trigger_event?: string; enabled?: number; current_view?: string; logic_tree?: string; summary?: string; primitive_type?: string; label_tag?: string | null }): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.instructions !== undefined) { sets.push('instructions = ?'); vals.push(fields.instructions); }
    if (fields.trigger_event !== undefined) { sets.push('trigger_event = ?'); vals.push(fields.trigger_event); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled); }
    if (fields.current_view !== undefined) { sets.push('current_view = ?'); vals.push(fields.current_view); }
    if (fields.logic_tree !== undefined) { sets.push('logic_tree = ?'); vals.push(fields.logic_tree); }
    if (fields.summary !== undefined) { sets.push('summary = ?'); vals.push(fields.summary); }
    if (fields.primitive_type !== undefined) { sets.push('primitive_type = ?'); vals.push(fields.primitive_type); }
    if (fields.label_tag !== undefined) { sets.push('label_tag = ?'); vals.push(fields.label_tag); }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    vals.push(this.now());
    this.run(`UPDATE agent_skills SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  }

  setSkillEnabled(id: string, enabled: number): void {
    this.run('UPDATE agent_skills SET enabled = ?, updated_at = ? WHERE id = ?', [enabled, this.now(), id]);
  }

  deleteSkill(id: string): void {
    this.run('DELETE FROM agent_skills WHERE id = ?', [id]);
  }
}
