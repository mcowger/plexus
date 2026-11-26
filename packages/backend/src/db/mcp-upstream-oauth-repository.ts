import { randomUUID } from 'node:crypto';

import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { and, eq, exists, ne, sql } from 'drizzle-orm';

import { decrypt, encrypt } from '../utils/encryption';
import { getDatabase, getSchema } from './client';

export interface UpstreamOAuthConnection {
  id: number;
  name: string;
  upstreamUrl: string;
  oauth: { client?: string; scopes?: string[] };
  revision: string;
}

export interface UpstreamOAuthGrant {
  version: string;
  revision: string;
  clientRevision?: string;
  clientProfileId?: string;
  authorizationServerUrl: string;
  resource: string;
  metadata: AuthorizationServerMetadata;
  clientInformation: OAuthClientInformationMixed;
  tokens: OAuthTokens;
  expiresAt?: number;
  reconnectRequired?: boolean;
}

export const mcpUpstreamOAuthRepository = {
  async getConnection(name: string): Promise<UpstreamOAuthConnection | null> {
    const db = getDatabase();
    const { mcpServers } = getSchema();
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.name, name)).limit(1);
    if (!row || row.mode !== 'remote_http' || !row.upstreamOauth || !row.upstreamOauthRevision)
      return null;
    return {
      id: row.id,
      name: row.name,
      upstreamUrl: row.upstreamUrl,
      oauth: JSON.parse(row.upstreamOauth),
      revision: row.upstreamOauthRevision,
    };
  },

  async getGrant(serverId: number): Promise<UpstreamOAuthGrant | null> {
    const db = getDatabase();
    const { mcpServers, mcpUpstreamOauthGrants: grants } = getSchema();
    const [row] = await db
      .select({ version: grants.version, revision: grants.revision, payload: grants.payload })
      .from(grants)
      .innerJoin(
        mcpServers,
        and(
          eq(grants.serverId, mcpServers.id),
          eq(grants.revision, mcpServers.upstreamOauthRevision)
        )
      )
      .where(eq(grants.serverId, serverId))
      .limit(1);
    if (!row) return null;
    return { ...JSON.parse(decrypt(row.payload)), version: row.version, revision: row.revision };
  },

  async saveGrant(
    connection: UpstreamOAuthConnection,
    grant: Omit<UpstreamOAuthGrant, 'version' | 'revision'>,
    expectedVersion?: string | null
  ): Promise<boolean> {
    const db = getDatabase();
    const {
      mcpServers,
      mcpUpstreamOauthGrants: grants,
      mcpUpstreamOauthClients: clients,
    } = getSchema();
    const version = randomUUID();
    const payload = encrypt(JSON.stringify(grant));
    const profileId = grant.clientProfileId ?? connection.oauth.client;
    const clientCondition = profileId
      ? exists(
          db
            .select({ id: clients.id })
            .from(clients)
            .where(and(eq(clients.id, profileId), eq(clients.revision, grant.clientRevision ?? '')))
        )
      : sql`1 = 1`;
    const selection = db
      .select({
        serverId: mcpServers.id,
        revision: sql<string>`${connection.revision}`.as('revision'),
        version: sql<string>`${version}`.as('version'),
        payload: sql<string>`${payload}`.as('payload'),
      })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, connection.id),
          eq(mcpServers.upstreamOauthRevision, connection.revision),
          clientCondition
        )
      );
    const conflictCondition =
      expectedVersion === undefined
        ? sql`1 = 1`
        : expectedVersion === null
          ? ne(grants.revision, connection.revision)
          : and(eq(grants.revision, connection.revision), eq(grants.version, expectedVersion));
    // A versioned write must not insert if the previous grant was deleted.
    if (typeof expectedVersion === 'string') {
      const result = await db
        .update(grants)
        .set({ revision: connection.revision, version, payload })
        .where(
          and(
            eq(grants.serverId, connection.id),
            conflictCondition,
            exists(
              db
                .select({ id: mcpServers.id })
                .from(mcpServers)
                .where(
                  and(
                    eq(mcpServers.id, connection.id),
                    eq(mcpServers.upstreamOauthRevision, connection.revision),
                    clientCondition
                  )
                )
            )
          )
        )
        .returning({ serverId: grants.serverId });
      return result.length > 0;
    }
    const result = await db
      .insert(grants)
      .select(selection)
      .onConflictDoUpdate({
        target: grants.serverId,
        set: { revision: connection.revision, version, payload },
        setWhere: conflictCondition,
      })
      .returning({ serverId: grants.serverId });
    return result.length > 0;
  },

  async deleteGrant(connection: UpstreamOAuthConnection): Promise<void> {
    const db = getDatabase();
    const { mcpServers, mcpUpstreamOauthGrants: grants } = getSchema();
    await db
      .update(mcpServers)
      .set({ upstreamOauthRevision: randomUUID() })
      .where(
        and(
          eq(mcpServers.id, connection.id),
          eq(mcpServers.upstreamOauthRevision, connection.revision)
        )
      );
    await db
      .delete(grants)
      .where(and(eq(grants.serverId, connection.id), eq(grants.revision, connection.revision)));
  },

  async getClient(id: string): Promise<{
    id: string;
    issuer: string;
    clientId: string;
    clientSecret?: string;
    revision: string;
  } | null> {
    const { mcpUpstreamOauthClients: clients } = getSchema();
    const [row] = await getDatabase().select().from(clients).where(eq(clients.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      issuer: row.issuer,
      clientId: row.clientId,
      ...(row.clientSecret ? { clientSecret: decrypt(row.clientSecret) } : {}),
      revision: row.revision,
    };
  },

  async listClients(): Promise<{ id: string; issuer: string; clientId: string }[]> {
    const { mcpUpstreamOauthClients: clients } = getSchema();
    return await getDatabase()
      .select({ id: clients.id, issuer: clients.issuer, clientId: clients.clientId })
      .from(clients);
  },

  async saveClient(
    id: string,
    input: { issuer: string; clientId: string; clientSecret?: string | null }
  ): Promise<void> {
    const db = getDatabase();
    const { mcpUpstreamOauthClients: clients } = getSchema();
    const existing = await this.getClient(id);
    const secret =
      input.clientSecret === undefined &&
      existing?.issuer === input.issuer &&
      existing.clientId === input.clientId
        ? existing.clientSecret
        : (input.clientSecret ?? undefined);
    const unchanged =
      existing &&
      existing.issuer === input.issuer &&
      existing.clientId === input.clientId &&
      existing.clientSecret === secret;
    const values = {
      issuer: input.issuer,
      clientId: input.clientId,
      clientSecret: secret ? encrypt(secret) : null,
      revision: unchanged ? existing.revision : randomUUID(),
    };
    await db
      .insert(clients)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: clients.id, set: values });
  },
};
