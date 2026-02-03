import type { QuotaCheckResult, QuotaWindow, QuotaCheckerConfig, QuotaGroup } from '../../../types/quota';
import { QuotaChecker } from '../quota-checker';

interface AntigravityModelGroup {
  groupId: string;
  groupLabel: string;
  models: string[];
  remainingFraction: number;
  resetTime: string;
}

interface AntigravityResponse {
  modelGroups?: AntigravityModelGroup[];
}

export class AntigravityQuotaChecker extends QuotaChecker {
  private credentialsPath: string;
  private projectId: string;
  private endpoints: string[];

  constructor(config: QuotaCheckerConfig) {
    super(config);
    this.credentialsPath = this.requireOption<string>('credentialsPath');
    this.projectId = this.getOption<string>('projectId', 'bamboo-precept-lgxtn');
    this.endpoints = [
      'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
      'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
      'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
    ];
  }

  async checkQuota(): Promise<QuotaCheckResult> {
    try {
      const credentials = await this.loadCredentials();
      if (!credentials) {
        return this.errorResult(new Error('Failed to load Google credentials'));
      }

      const accessToken = await this.getAccessToken(credentials);
      if (!accessToken) {
        return this.errorResult(new Error('Failed to obtain access token'));
      }

      let lastError: Error | null = null;
      for (const endpoint of this.endpoints) {
        try {
          const response = await fetch(`${endpoint}?projectId=${this.projectId}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          });

          if (response.ok) {
            const data: AntigravityResponse = await response.json();
            const groups: QuotaGroup[] = [];

            if (data.modelGroups) {
              for (const mg of data.modelGroups) {
                const windows: QuotaWindow[] = [];
                windows.push(this.createWindow(
                  'custom',
                  1,
                  1 - mg.remainingFraction,
                  undefined,
                  'percentage',
                  new Date(mg.resetTime),
                  `${mg.groupLabel} quota`
                ));

                groups.push({
                  groupId: mg.groupId,
                  groupLabel: mg.groupLabel,
                  models: mg.models,
                  windows,
                });
              }
            }

            return this.successResult(undefined, groups);
          }
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        } catch (e) {
          lastError = e as Error;
        }
      }

      return this.errorResult(lastError || new Error('All endpoints failed'));
    } catch (error) {
      return this.errorResult(error as Error);
    }
  }

  private async loadCredentials(): Promise<Record<string, unknown> | null> {
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(this.credentialsPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async getAccessToken(credentials: Record<string, unknown>): Promise<string | null> {
    const jwt = await this.createJwt(credentials);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.access_token;
    }
    return null;
  }

  private async createJwt(credentials: Record<string, unknown>): Promise<string> {
    const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url');

    return `${header}.${payload}.signature`;
  }
}