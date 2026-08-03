import type { FastifyReply, FastifyRequest } from 'fastify';

export interface OAuthDiscoveryMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
  resource_supported: boolean;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
}

export interface AuthProvider {
  getDiscoveryMetadata(req: FastifyRequest): OAuthDiscoveryMetadata;
  getProtectedResourceMetadata(req: FastifyRequest): ProtectedResourceMetadata;
  handleAuthorize(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  handleToken(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  handleRegister(req: FastifyRequest, reply: FastifyReply): Promise<void>;
  validateToken(token: string): Promise<{ keyName: string; scopes: string[] } | null>;
}
