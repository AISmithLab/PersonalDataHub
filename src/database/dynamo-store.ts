/**
 * DynamoDataStore — DataStore implementation backed by DynamoDB.
 *
 * Used in serverless / AWS Lambda mode. Single-table design with
 * PK/SK patterns to store all entities.
 *
 * PK/SK patterns:
 *   USER#{email}    / PROFILE         — user accounts (email + password hash)
 *   SESSION#{token} / SESSION        — browser sessions (TTL)
 *   TOKEN#{source}  / TOKEN          — OAuth tokens
 *   STAGING#{id}    / STAGING        — staged actions
 *   AUDIT#{ts}#{uuid} / AUDIT        — audit log entries
 *   FILTER#{id}     / FILTER         — data filters
 *   GHREPO#{name}   / GHREPO         — GitHub repos
 *   STATE#{state}   / STATE          — OAuth CSRF state (TTL)
 *   AGENT#{token hash} / AGENT       — registered agents (token hash only)
 *   AGENTNAME#{name} / AGENTNAME     — reserves an agent name (uniqueness)
 *   JOINCODE#{code} / JOINCODE       — one-time agent join codes
 *   PIPE#{id}       / PIPE           — pipes (filter programs exposed to agents)
 */

import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type {
  DataStore,
  StoredTokenRow,
  StagingRow,
  FilterRow,
  AuditRow,
  MemoryRow,
  AgentRow,
  PipeRow,
  JoinCodeRow,
  SkillRow,
  GitHubRepoRow,
  GitHubRepoInput,
  OAuthStateData,
} from './datastore.js';

export class DynamoDataStore implements DataStore {
  private docClient: DynamoDBDocumentClient;

  constructor(
    private tableName: string,
    clientConfig?: DynamoDBClientConfig,
  ) {
    const client = new DynamoDBClient(clientConfig ?? {});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  // --- Sessions ---

  async getValidSession(token: string): Promise<{ token: string } | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `SESSION#${token}`, SK: 'SESSION' },
    }));
    if (!result.Item) return null;
    // Check TTL — DynamoDB may not have purged expired items yet
    if (result.Item.ttl && result.Item.ttl < Math.floor(Date.now() / 1000)) return null;
    return { token };
  }

  async createSession(token: string, expiresAt: string): Promise<void> {
    const ttl = Math.floor(new Date(expiresAt).getTime() / 1000);
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: `SESSION#${token}`, SK: 'SESSION', token, expires_at: expiresAt, ttl },
    }));
  }

  async deleteSession(token: string): Promise<void> {
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `SESSION#${token}`, SK: 'SESSION' },
    }));
  }

  // --- Users ---

  async getUserByEmail(email: string): Promise<{ id: number; email: string; password_hash: string } | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `USER#${email.toLowerCase()}`, SK: 'PROFILE' },
    }));
    if (!result.Item?.email) return null;
    return {
      id: result.Item.id as number ?? 1,
      email: result.Item.email as string,
      password_hash: result.Item.password_hash as string,
    };
  }

  async createUser(email: string, passwordHash: string): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: `USER#${email.toLowerCase()}`, SK: 'PROFILE', email, password_hash: passwordHash, id: Date.now() },
    }));
  }

  async getUserCount(): Promise<number> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
      ExpressionAttributeValues: { ':prefix': 'USER#', ':sk': 'PROFILE' },
      Select: 'COUNT',
    }));
    return result.Count ?? 0;
  }

  // --- OAuth Tokens ---

  async upsertToken(source: string, fields: {
    access_token: string;
    refresh_token: string | null;
    token_type: string;
    expires_at: string | null;
    scopes: string;
    account_info: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `TOKEN#${source}`,
        SK: 'TOKEN',
        source,
        access_token: fields.access_token,
        refresh_token: fields.refresh_token,
        token_type: fields.token_type,
        expires_at: fields.expires_at,
        scopes: fields.scopes,
        account_info: fields.account_info,
        created_at: now,
        updated_at: now,
      },
    }));
  }

  async getToken(source: string): Promise<StoredTokenRow | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
    }));
    if (!result.Item) return null;
    return {
      source: result.Item.source,
      access_token: result.Item.access_token,
      refresh_token: result.Item.refresh_token ?? null,
      token_type: result.Item.token_type,
      expires_at: result.Item.expires_at ?? null,
      scopes: result.Item.scopes,
      account_info: result.Item.account_info,
      created_at: result.Item.created_at,
      updated_at: result.Item.updated_at,
    };
  }

  async hasToken(source: string): Promise<boolean> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
      ProjectionExpression: 'PK',
    }));
    return !!result.Item;
  }

  async getAccountInfo(source: string): Promise<string | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
      ProjectionExpression: 'account_info',
    }));
    return result.Item?.account_info ?? null;
  }

  async updateAccountInfo(source: string, info: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
      UpdateExpression: 'SET account_info = :info, updated_at = :now',
      ExpressionAttributeValues: { ':info': info, ':now': new Date().toISOString() },
    }));
  }

  async deleteToken(source: string): Promise<void> {
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
    }));
  }

  async getTokenExpiresAt(source: string): Promise<string | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
      ProjectionExpression: 'expires_at',
    }));
    return result.Item?.expires_at ?? null;
  }

  async updateAccessToken(source: string, accessToken: string, expiresAt: string | null): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `TOKEN#${source}`, SK: 'TOKEN' },
      UpdateExpression: 'SET access_token = :at, expires_at = :ea, updated_at = :now',
      ExpressionAttributeValues: {
        ':at': accessToken,
        ':ea': expiresAt,
        ':now': new Date().toISOString(),
      },
    }));
  }

  // --- Staging ---

  async insertStagingAction(action: {
    actionId: string;
    manifestId: string;
    source: string;
    actionType: string;
    actionData: string;
    purpose: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `STAGING#${action.actionId}`,
        SK: 'STAGING',
        action_id: action.actionId,
        manifest_id: action.manifestId || null,
        source: action.source,
        action_type: action.actionType,
        action_data: action.actionData,
        purpose: action.purpose,
        status: 'pending',
        proposed_at: now,
        resolved_at: null,
      },
    }));
  }

  async getStagingAction(actionId: string): Promise<StagingRow | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `STAGING#${actionId}`, SK: 'STAGING' },
    }));
    if (!result.Item) return null;
    return this.toStagingRow(result.Item);
  }

  async getAllStagingActions(): Promise<StagingRow[]> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'STAGING' },
    }));
    const rows = (result.Items ?? []).map((item) => this.toStagingRow(item));
    // Sort by proposed_at descending (matching SQLite ORDER BY proposed_at DESC)
    rows.sort((a, b) => b.proposed_at.localeCompare(a.proposed_at));
    return rows;
  }

  async updateStagingStatus(actionId: string, status: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `STAGING#${actionId}`, SK: 'STAGING' },
      UpdateExpression: 'SET #s = :status, resolved_at = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': new Date().toISOString() },
    }));
  }

  async updateStagingActionData(actionId: string, actionData: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `STAGING#${actionId}`, SK: 'STAGING' },
      UpdateExpression: 'SET action_data = :ad',
      ExpressionAttributeValues: { ':ad': actionData },
    }));
  }

  // --- Filters ---

  async getFiltersBySource(source: string): Promise<FilterRow[]> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk AND #src = :source',
      ExpressionAttributeNames: { '#src': 'source' },
      ExpressionAttributeValues: { ':sk': 'FILTER', ':source': source },
    }));
    const rows = (result.Items ?? []).map((item) => this.toFilterRow(item));
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows;
  }

  async getAllFilters(): Promise<FilterRow[]> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'FILTER' },
    }));
    const rows = (result.Items ?? []).map((item) => this.toFilterRow(item));
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows;
  }

  async getEnabledFiltersBySource(source: string): Promise<FilterRow[]> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk AND #src = :source AND enabled = :e',
      ExpressionAttributeNames: { '#src': 'source' },
      ExpressionAttributeValues: { ':sk': 'FILTER', ':source': source, ':e': 1 },
    }));
    return (result.Items ?? []).map((item) => this.toFilterRow(item));
  }

  async createFilter(filter: { id: string; source: string; type: string; value: string; enabled: number }): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `FILTER#${filter.id}`,
        SK: 'FILTER',
        id: filter.id,
        source: filter.source,
        type: filter.type,
        value: filter.value,
        enabled: filter.enabled,
        created_at: new Date().toISOString(),
      },
    }));
  }

  async updateFilter(id: string, value: string, enabled: number): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `FILTER#${id}`, SK: 'FILTER' },
      UpdateExpression: 'SET #v = :value, enabled = :enabled',
      ExpressionAttributeNames: { '#v': 'value' },
      ExpressionAttributeValues: { ':value': value, ':enabled': enabled },
    }));
  }

  async deleteFilter(id: string): Promise<void> {
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `FILTER#${id}`, SK: 'FILTER' },
    }));
  }

  // --- Audit Log ---

  async insertAuditEntry(entry: { timestamp: string; event: string; source: string | null; details: string }): Promise<void> {
    const uuid = randomUUID();
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `AUDIT#${entry.timestamp}#${uuid}`,
        SK: 'AUDIT',
        timestamp: entry.timestamp,
        event: entry.event,
        source: entry.source,
        details: entry.details,
        // Synthetic auto-increment for ordering
        id: Date.now(),
      },
    }));
  }

  async queryAuditEntries(filters: { after?: string; before?: string; event?: string; source?: string; limit?: number }): Promise<AuditRow[]> {
    const filterParts: string[] = ['SK = :sk'];
    const exprValues: Record<string, unknown> = { ':sk': 'AUDIT' };
    const exprNames: Record<string, string> = {};

    if (filters.after) {
      filterParts.push('#ts >= :after');
      exprNames['#ts'] = 'timestamp';
      exprValues[':after'] = filters.after;
    }
    if (filters.before) {
      filterParts.push('#ts <= :before');
      if (!exprNames['#ts']) exprNames['#ts'] = 'timestamp';
      exprValues[':before'] = filters.before;
    }
    if (filters.event) {
      filterParts.push('#ev = :event');
      exprNames['#ev'] = 'event';
      exprValues[':event'] = filters.event;
    }
    if (filters.source) {
      filterParts.push('#src = :source');
      exprNames['#src'] = 'source';
      exprValues[':source'] = filters.source;
    }

    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: exprValues,
      ...(Object.keys(exprNames).length > 0 ? { ExpressionAttributeNames: exprNames } : {}),
    }));

    const rows: AuditRow[] = (result.Items ?? []).map((item) => ({
      id: item.id as number,
      timestamp: item.timestamp as string,
      event: item.event as string,
      source: (item.source as string | null) ?? null,
      details: item.details as string,
    }));

    // Sort by id ASC (matching SQLite ORDER BY id ASC)
    rows.sort((a, b) => a.id - b.id);

    if (filters.limit) {
      return rows.slice(0, filters.limit);
    }
    return rows;
  }

  async deleteAllAuditEntries(): Promise<void> {
    // Scan for all audit entries, then batch-delete
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'AUDIT' },
      ProjectionExpression: 'PK, SK',
    }));
    const items = result.Items ?? [];
    // BatchWrite in chunks of 25 (DynamoDB limit)
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25);
      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map((item) => ({
            DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
          })),
        },
      }));
    }
  }

  // --- GitHub Repos ---

  async upsertGitHubRepos(repos: GitHubRepoInput[]): Promise<void> {
    // DynamoDB BatchWrite supports max 25 items per call
    const now = new Date().toISOString();
    const chunks = this.chunk(repos, 25);
    for (const batch of chunks) {
      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map((repo) => ({
            PutRequest: {
              Item: {
                PK: `GHREPO#${repo.full_name}`,
                SK: 'GHREPO',
                full_name: repo.full_name,
                owner: repo.owner,
                name: repo.name,
                private: repo.isPrivate ? 1 : 0,
                description: repo.description,
                is_org: repo.isOrg ? 1 : 0,
                enabled: 0,
                permissions: 'read',
                fetched_at: now,
              },
            },
          })),
        },
      }));
    }
  }

  async getAllGitHubRepos(): Promise<GitHubRepoRow[]> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'GHREPO' },
    }));
    const rows = (result.Items ?? []).map((item) => this.toGitHubRepoRow(item));
    rows.sort((a, b) => {
      const ownerCmp = a.owner.localeCompare(b.owner);
      return ownerCmp !== 0 ? ownerCmp : a.name.localeCompare(b.name);
    });
    return rows;
  }

  async getEnabledGitHubRepos(): Promise<Array<{ full_name: string }>> {
    const result = await this.docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'SK = :sk AND enabled = :e',
      ExpressionAttributeValues: { ':sk': 'GHREPO', ':e': 1 },
      ProjectionExpression: 'full_name',
    }));
    return (result.Items ?? []).map((item) => ({ full_name: item.full_name as string }));
  }

  async updateGitHubRepoSettings(updates: Array<{ full_name: string; enabled: boolean; permissions: string }>): Promise<void> {
    for (const u of updates) {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `GHREPO#${u.full_name}`, SK: 'GHREPO' },
        UpdateExpression: 'SET enabled = :e, permissions = :p',
        ExpressionAttributeValues: { ':e': u.enabled ? 1 : 0, ':p': u.permissions },
      }));
    }
  }

  // --- OAuth State (CSRF) ---

  async setOAuthState(state: string, data: OAuthStateData): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `STATE#${state}`,
        SK: 'STATE',
        source: data.source,
        createdAt: data.createdAt,
        codeVerifier: data.codeVerifier,
        ttl,
      },
    }));
  }

  async getAndDeleteOAuthState(state: string): Promise<OAuthStateData | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `STATE#${state}`, SK: 'STATE' },
    }));
    if (!result.Item) return null;
    // Check TTL
    if (result.Item.ttl && (result.Item.ttl as number) < Math.floor(Date.now() / 1000)) {
      return null;
    }
    // Delete after reading (consume-once)
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `STATE#${state}`, SK: 'STATE' },
    }));
    return {
      source: result.Item.source as string,
      createdAt: result.Item.createdAt as number,
      codeVerifier: result.Item.codeVerifier as string,
    };
  }

  // --- Agents ---

  private toAgentRow(item: Record<string, unknown>): AgentRow {
    return {
      id: String(item.id),
      name: String(item.name),
      token_hash: String(item.token_hash),
      permissions: String(item.permissions ?? '[]'),
      created_at: String(item.created_at),
      last_used_at: item.last_used_at ? String(item.last_used_at) : null,
    };
  }

  async listAgents(): Promise<AgentRow[]> {
    // A filtered Scan reads at most 1 MB per call, so page through the table;
    // otherwise an agent could be missing from the list and impossible to revoke.
    const rows: AgentRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'AGENT' },
        ExclusiveStartKey: startKey,
      }));
      for (const item of result.Items ?? []) rows.push(this.toAgentRow(item));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return rows;
  }

  async insertAgent(agent: { id: string; name: string; token_hash: string; permissions: string }): Promise<void> {
    // No unique index on name in a single-table design, so a name is reserved with
    // its own item, written only if absent. Two joins cannot both win it.
    try {
      await this.docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: { PK: `AGENTNAME#${agent.name}`, SK: 'AGENTNAME', id: agent.id },
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        throw new Error(`UNIQUE constraint failed: agents.name (${agent.name})`);
      }
      throw err;
    }
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `AGENT#${agent.token_hash}`,
        SK: 'AGENT',
        id: agent.id,
        name: agent.name,
        token_hash: agent.token_hash,
        permissions: agent.permissions,
        created_at: new Date().toISOString(),
      },
    }));
  }

  async getAgentByTokenHash(tokenHash: string): Promise<AgentRow | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `AGENT#${tokenHash}`, SK: 'AGENT' },
    }));
    return result.Item ? this.toAgentRow(result.Item) : null;
  }

  private async agentKeyById(id: string): Promise<{ PK: string; SK: string } | null> {
    const row = (await this.listAgents()).find((a) => a.id === id);
    return row ? { PK: `AGENT#${row.token_hash}`, SK: 'AGENT' } : null;
  }

  // An UpdateCommand creates the item if it is missing. Every update of an agent is
  // therefore conditional on the item still existing: otherwise an update that
  // races with a revoke would bring the revoked agent's token back to life.
  private async updateExistingAgent(key: { PK: string; SK: string }, update: Omit<ConstructorParameters<typeof UpdateCommand>[0], 'TableName' | 'Key' | 'ConditionExpression'>): Promise<void> {
    try {
      await this.docClient.send(new UpdateCommand({ TableName: this.tableName, Key: key, ConditionExpression: 'attribute_exists(PK)', ...update }));
    } catch (err) {
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    }
  }

  async touchAgent(id: string): Promise<void> {
    const key = await this.agentKeyById(id);
    if (!key) return;
    await this.updateExistingAgent(key, {
      UpdateExpression: 'SET last_used_at = :t',
      ExpressionAttributeValues: { ':t': new Date().toISOString() },
    });
  }

  async updateAgentPermissions(id: string, permissions: string): Promise<void> {
    const key = await this.agentKeyById(id);
    if (!key) return;
    await this.updateExistingAgent(key, {
      UpdateExpression: 'SET #p = :p',
      ExpressionAttributeNames: { '#p': 'permissions' },
      ExpressionAttributeValues: { ':p': permissions },
    });
  }

  async deleteAgent(id: string): Promise<void> {
    const row = (await this.listAgents()).find((a) => a.id === id);
    if (!row) return;
    await this.docClient.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: `AGENT#${row.token_hash}`, SK: 'AGENT' } }));
    await this.docClient.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: `AGENTNAME#${row.name}`, SK: 'AGENTNAME' } }));
  }

  // --- Join codes ---

  async insertJoinCode(code: { code: string; permissions: string; expires_at: string }): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `JOINCODE#${code.code}`,
        SK: 'JOINCODE',
        code: code.code,
        permissions: code.permissions,
        created_at: new Date().toISOString(),
        expires_at: code.expires_at,
        // DynamoDB TTL (epoch seconds) clears old codes a day after they expire.
        ttl: Math.floor(new Date(code.expires_at).getTime() / 1000) + 86400,
      },
    }));
  }

  async getJoinCode(code: string): Promise<JoinCodeRow | null> {
    const result = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `JOINCODE#${code}`, SK: 'JOINCODE' },
    }));
    const item = result.Item;
    if (!item) return null;
    return {
      code: String(item.code),
      permissions: String(item.permissions ?? '[]'),
      created_at: String(item.created_at),
      expires_at: String(item.expires_at),
      used_at: item.used_at ? String(item.used_at) : null,
    };
  }

  async consumeJoinCode(code: string): Promise<boolean> {
    try {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `JOINCODE#${code}`, SK: 'JOINCODE' },
        UpdateExpression: 'SET used_at = :t',
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(used_at)',
        ExpressionAttributeValues: { ':t': new Date().toISOString() },
      }));
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async releaseJoinCode(code: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { PK: `JOINCODE#${code}`, SK: 'JOINCODE' },
      UpdateExpression: 'REMOVE used_at',
      ConditionExpression: 'attribute_exists(PK)',
    })).catch((err) => {
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    });
  }

  // --- Pipes ---

  private toPipeRow(item: Record<string, unknown>): PipeRow {
    return {
      id: String(item.id),
      name: String(item.name ?? ''),
      description: String(item.description ?? ''),
      source: String(item.source ?? ''),
      query: String(item.query ?? ''),
      program: String(item.program ?? ''),
      enabled: Number(item.enabled ?? 1),
      created_at: String(item.created_at ?? ''),
      updated_at: String(item.updated_at ?? ''),
    };
  }

  async listPipes(): Promise<PipeRow[]> {
    const rows: PipeRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'SK = :sk',
        ExpressionAttributeValues: { ':sk': 'PIPE' },
        ExclusiveStartKey: startKey,
      }));
      for (const item of result.Items ?? []) rows.push(this.toPipeRow(item));
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return rows;
  }

  async getPipe(id: string): Promise<PipeRow | null> {
    const result = await this.docClient.send(new GetCommand({ TableName: this.tableName, Key: { PK: `PIPE#${id}`, SK: 'PIPE' } }));
    return result.Item ? this.toPipeRow(result.Item) : null;
  }

  async insertPipe(pipe: { id: string; name: string; description: string; source: string; query: string; program: string; enabled: number }): Promise<void> {
    const now = new Date().toISOString();
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: `PIPE#${pipe.id}`, SK: 'PIPE', ...pipe, created_at: now, updated_at: now },
      // Never overwrite: an existing id may already be granted to agents.
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  }

  async updatePipe(id: string, fields: { name?: string; description?: string; source?: string; query?: string; program?: string; enabled?: number }): Promise<void> {
    const current = await this.getPipe(id);
    if (!current) return;
    const next = { ...current };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: { PK: `PIPE#${id}`, SK: 'PIPE', ...next, updated_at: new Date().toISOString() },
      ConditionExpression: 'attribute_exists(PK)',
    })).catch((err) => {
      if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    });
  }

  async deletePipe(id: string): Promise<void> {
    await this.docClient.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: `PIPE#${id}`, SK: 'PIPE' } }));
  }

  // --- AI Memories (not implemented for DynamoDB — Android uses SQLite) ---

  async listMemories(): Promise<MemoryRow[]> { return []; }
  async insertMemory(_id: string, _content: string): Promise<void> {}
  async updateMemory(_id: string, _content: string): Promise<void> {}
  async deleteMemory(_id: string): Promise<void> {}

  // --- Agent Skills (not implemented for DynamoDB) ---
  async listSkills(): Promise<SkillRow[]> { return []; }
  async insertSkill(_skill: { id: string; name: string; instructions: string; trigger_event: string; enabled?: number; current_view?: string; logic_tree?: string; summary?: string; primitive_type?: string; label_tag?: string | null; allowed_sources?: string | null }): Promise<void> {}
  async updateSkill(_id: string, _fields: { name?: string; instructions?: string; trigger_event?: string; enabled?: number; current_view?: string; logic_tree?: string; summary?: string; primitive_type?: string; label_tag?: string | null; allowed_sources?: string | null }): Promise<void> {}
  async setSkillEnabled(_id: string, _enabled: number): Promise<void> {}
  async deleteSkill(_id: string): Promise<void> {}

  // --- Helpers ---

  private toStagingRow(item: Record<string, unknown>): StagingRow {
    return {
      action_id: item.action_id as string,
      manifest_id: (item.manifest_id as string | null) ?? null,
      source: item.source as string,
      action_type: item.action_type as string,
      action_data: item.action_data as string,
      purpose: item.purpose as string,
      status: item.status as string,
      proposed_at: item.proposed_at as string,
      resolved_at: (item.resolved_at as string | null) ?? null,
    };
  }

  private toFilterRow(item: Record<string, unknown>): FilterRow {
    return {
      id: item.id as string,
      source: item.source as string,
      type: item.type as string,
      value: item.value as string,
      enabled: item.enabled as number,
      created_at: item.created_at as string,
    };
  }

  private toGitHubRepoRow(item: Record<string, unknown>): GitHubRepoRow {
    return {
      full_name: item.full_name as string,
      owner: item.owner as string,
      name: item.name as string,
      private: item.private as number,
      description: item.description as string,
      is_org: item.is_org as number,
      enabled: item.enabled as number,
      permissions: item.permissions as string,
      fetched_at: item.fetched_at as string,
    };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
