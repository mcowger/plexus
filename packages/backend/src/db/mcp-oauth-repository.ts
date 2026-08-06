import { and, eq, sql } from 'drizzle-orm';
import { getDatabase, getSchema } from './client';
import { decryptField, encryptField, hashSecret } from '../utils/encryption';

function now(): number {
  return Date.now();
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function stringifyArray(value: string[] | undefined): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

export interface McpOauthClientRecord {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  scope: string | null;
  tokenEndpointAuthMethod: string;
  status: 'active' | 'disabled';
  createdAt: number;
}

export interface NewMcpOauthClient {
  clientId: string;
  clientName?: string | null;
  redirectUris: string[];
  grantTypes?: string[];
  responseTypes?: string[];
  scope?: string | null;
  tokenEndpointAuthMethod?: string;
  status?: 'active' | 'disabled';
}

export interface McpOauthAuthorizationCodeRecord {
  codeHash: string;
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string | null;
  keyName: string;
  apiKeySecretHash: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

export interface NewMcpOauthAuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope?: string | null;
  keyName: string;
  apiKeySecretHash: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
}

export interface McpOauthTokenRecord {
  id?: number;
  accessTokenHash: string;
  accessToken: string;
  refreshTokenHash: string;
  refreshToken: string;
  clientId: string;
  keyName: string;
  apiKeySecretHash: string | null;
  resource: string;
  scope: string | null;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  revokedAt: number | null;
  createdAt: number;
}

export interface McpOauthClientWithTokensRecord extends McpOauthClientRecord {
  tokens: Array<Omit<McpOauthTokenRecord, 'accessToken' | 'refreshToken'>>;
}

export interface NewMcpOauthToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  keyName: string;
  apiKeySecretHash: string;
  resource: string;
  scope?: string | null;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

export class McpOauthRepository {
  private db() {
    return getDatabase();
  }

  private schema() {
    return getSchema();
  }

  async createClient(input: NewMcpOauthClient): Promise<McpOauthClientRecord> {
    const schema = this.schema();
    const timestamp = now();
    await this.db()
      .insert(schema.mcpOauthClients)
      .values({
        clientId: input.clientId,
        clientName: input.clientName ?? null,
        redirectUris: JSON.stringify(input.redirectUris),
        grantTypes: stringifyArray(input.grantTypes),
        responseTypes: stringifyArray(input.responseTypes),
        scope: input.scope ?? null,
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? 'none',
        status: input.status ?? 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const client = await this.getClient(input.clientId);
    if (!client) throw new Error('Failed to create OAuth client');
    return client;
  }

  async getClient(clientId: string): Promise<McpOauthClientRecord | null> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.mcpOauthClients)
      .where(eq(schema.mcpOauthClients.clientId, clientId))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      clientId: row.clientId,
      clientName: row.clientName ?? null,
      redirectUris: parseJsonArray(row.redirectUris),
      grantTypes: parseJsonArray(row.grantTypes),
      responseTypes: parseJsonArray(row.responseTypes),
      scope: row.scope ?? null,
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
      status: row.status === 'disabled' ? 'disabled' : 'active',
      createdAt: row.createdAt,
    };
  }

  async findClientByRegistration(input: {
    clientName?: string | null;
    redirectUris: string[];
  }): Promise<McpOauthClientRecord | null> {
    const clients = await this.listClientsWithActiveTokens();
    const requested = normalizeStringSet(input.redirectUris);
    const clientName = input.clientName ?? null;

    return (
      clients.find(
        (client) =>
          client.clientName === clientName &&
          arraysEqual(normalizeStringSet(client.redirectUris), requested)
      ) ?? null
    );
  }

  async listClientsWithActiveTokens(): Promise<McpOauthClientWithTokensRecord[]> {
    const schema = this.schema();
    const [clientRows, tokenRows] = await Promise.all([
      this.db().select().from(schema.mcpOauthClients),
      this.db()
        .select()
        .from(schema.mcpOauthTokens)
        .where(
          and(
            sql`${schema.mcpOauthTokens.revokedAt} IS NULL`,
            sql`${schema.mcpOauthTokens.refreshTokenExpiresAt} > ${now()}`
          )
        ),
    ]);

    const tokensByClient = new Map<
      string,
      Array<Omit<McpOauthTokenRecord, 'accessToken' | 'refreshToken'>>
    >();
    for (const row of tokenRows) {
      const token = this.rowToToken(row);
      const safeToken = {
        id: token.id,
        accessTokenHash: token.accessTokenHash,
        refreshTokenHash: token.refreshTokenHash,
        clientId: token.clientId,
        keyName: token.keyName,
        apiKeySecretHash: token.apiKeySecretHash,
        resource: token.resource,
        scope: token.scope,
        accessTokenExpiresAt: token.accessTokenExpiresAt,
        refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        revokedAt: token.revokedAt,
        createdAt: token.createdAt,
      };
      const bucket = tokensByClient.get(token.clientId) ?? [];
      bucket.push(safeToken);
      tokensByClient.set(token.clientId, bucket);
    }

    return clientRows.map((row: any) => ({
      clientId: row.clientId,
      clientName: row.clientName ?? null,
      redirectUris: parseJsonArray(row.redirectUris),
      grantTypes: parseJsonArray(row.grantTypes),
      responseTypes: parseJsonArray(row.responseTypes),
      scope: row.scope ?? null,
      tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
      status: row.status === 'disabled' ? 'disabled' : 'active',
      createdAt: row.createdAt,
      tokens: tokensByClient.get(row.clientId) ?? [],
    }));
  }

  async createAuthorizationCode(
    input: NewMcpOauthAuthorizationCode
  ): Promise<McpOauthAuthorizationCodeRecord> {
    const schema = this.schema();
    const timestamp = now();
    const codeHash = hashSecret(input.code);
    await this.db()
      .insert(schema.mcpOauthAuthorizationCodes)
      .values({
        codeHash,
        code: encryptField(input.code)!,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        resource: input.resource,
        scope: input.scope ?? null,
        keyName: input.keyName,
        apiKeySecretHash: input.apiKeySecretHash,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: input.codeChallengeMethod,
        expiresAt: input.expiresAt,
        consumedAt: null,
        createdAt: timestamp,
      });

    const code = await this.getAuthorizationCode(input.code);
    if (!code) throw new Error('Failed to create OAuth authorization code');
    return code;
  }

  async getAuthorizationCode(code: string): Promise<McpOauthAuthorizationCodeRecord | null> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.mcpOauthAuthorizationCodes)
      .where(eq(schema.mcpOauthAuthorizationCodes.codeHash, hashSecret(code)))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0]!;
    return {
      codeHash: row.codeHash,
      code: decryptField(row.code) ?? '',
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      resource: row.resource,
      scope: row.scope ?? null,
      keyName: row.keyName,
      apiKeySecretHash: row.apiKeySecretHash ?? null,
      codeChallenge: row.codeChallenge,
      codeChallengeMethod: row.codeChallengeMethod,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt ?? null,
      createdAt: row.createdAt,
    };
  }

  async consumeAuthorizationCode(code: string): Promise<boolean> {
    const schema = this.schema();
    const result = await this.db()
      .update(schema.mcpOauthAuthorizationCodes)
      .set({ consumedAt: now() })
      .where(
        and(
          eq(schema.mcpOauthAuthorizationCodes.codeHash, hashSecret(code)),
          sql`${schema.mcpOauthAuthorizationCodes.consumedAt} IS NULL`,
          sql`${schema.mcpOauthAuthorizationCodes.expiresAt} > ${now()}`
        )
      );
    return getAffectedRowCount(result) > 0;
  }

  async createToken(input: NewMcpOauthToken): Promise<McpOauthTokenRecord> {
    const schema = this.schema();
    const timestamp = now();
    const accessTokenHash = hashSecret(input.accessToken);
    const refreshTokenHash = hashSecret(input.refreshToken);
    await this.db()
      .insert(schema.mcpOauthTokens)
      .values({
        accessTokenHash,
        accessToken: encryptField(input.accessToken)!,
        refreshTokenHash,
        refreshToken: encryptField(input.refreshToken)!,
        clientId: input.clientId,
        keyName: input.keyName,
        apiKeySecretHash: input.apiKeySecretHash,
        resource: input.resource,
        scope: input.scope ?? null,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        revokedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const token = await this.getAccessToken(input.accessToken);
    if (!token) throw new Error('Failed to create OAuth token');
    return token;
  }

  async getAccessToken(accessToken: string): Promise<McpOauthTokenRecord | null> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.mcpOauthTokens)
      .where(eq(schema.mcpOauthTokens.accessTokenHash, hashSecret(accessToken)))
      .limit(1);

    return rows.length > 0 ? this.rowToToken(rows[0]!) : null;
  }

  async getRefreshToken(refreshToken: string): Promise<McpOauthTokenRecord | null> {
    const schema = this.schema();
    const rows = await this.db()
      .select()
      .from(schema.mcpOauthTokens)
      .where(eq(schema.mcpOauthTokens.refreshTokenHash, hashSecret(refreshToken)))
      .limit(1);

    return rows.length > 0 ? this.rowToToken(rows[0]!) : null;
  }

  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    const schema = this.schema();
    const result = await this.db()
      .update(schema.mcpOauthTokens)
      .set({ revokedAt: now(), updatedAt: now() })
      .where(
        and(
          eq(schema.mcpOauthTokens.refreshTokenHash, hashSecret(refreshToken)),
          sql`${schema.mcpOauthTokens.revokedAt} IS NULL`
        )
      );
    return getAffectedRowCount(result) > 0;
  }

  async revokeTokenById(id: number): Promise<number> {
    const schema = this.schema();
    const result = await this.db()
      .update(schema.mcpOauthTokens)
      .set({ revokedAt: now(), updatedAt: now() })
      .where(
        and(eq(schema.mcpOauthTokens.id, id), sql`${schema.mcpOauthTokens.revokedAt} IS NULL`)
      );
    return getAffectedRowCount(result);
  }

  async revokeTokensForKeyName(keyName: string): Promise<number> {
    const schema = this.schema();
    const result = await this.db()
      .update(schema.mcpOauthTokens)
      .set({ revokedAt: now(), updatedAt: now() })
      .where(
        and(
          eq(schema.mcpOauthTokens.keyName, keyName),
          sql`${schema.mcpOauthTokens.revokedAt} IS NULL`
        )
      );
    return getAffectedRowCount(result);
  }

  async setClientStatus(clientId: string, status: 'active' | 'disabled'): Promise<void> {
    const schema = this.schema();
    await this.db()
      .update(schema.mcpOauthClients)
      .set({ status, updatedAt: now() })
      .where(eq(schema.mcpOauthClients.clientId, clientId));
  }

  async deleteClient(clientId: string): Promise<void> {
    const schema = this.schema();
    await this.db()
      .delete(schema.mcpOauthClients)
      .where(eq(schema.mcpOauthClients.clientId, clientId));
  }

  async revokeTokensForClient(clientId: string): Promise<number> {
    const schema = this.schema();
    const result = await this.db()
      .update(schema.mcpOauthTokens)
      .set({ revokedAt: now(), updatedAt: now() })
      .where(
        and(
          eq(schema.mcpOauthTokens.clientId, clientId),
          sql`${schema.mcpOauthTokens.revokedAt} IS NULL`
        )
      );
    return getAffectedRowCount(result);
  }

  private rowToToken(row: any): McpOauthTokenRecord {
    return {
      id: row.id,
      accessTokenHash: row.accessTokenHash,
      accessToken: decryptField(row.accessToken) ?? '',
      refreshTokenHash: row.refreshTokenHash,
      refreshToken: decryptField(row.refreshToken) ?? '',
      clientId: row.clientId,
      keyName: row.keyName,
      apiKeySecretHash: row.apiKeySecretHash ?? null,
      resource: row.resource,
      scope: row.scope ?? null,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      refreshTokenExpiresAt: row.refreshTokenExpiresAt,
      revokedAt: row.revokedAt ?? null,
      createdAt: row.createdAt,
    };
  }
}

function normalizeStringSet(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function getAffectedRowCount(result: unknown): number {
  return Number(
    (result as any)?.rowsAffected ??
      (result as any)?.changes ??
      (result as any)?.rowCount ??
      (result as any)?.count ??
      0
  );
}
