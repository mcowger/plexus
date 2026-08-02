import { setupTestDatabase } from './vitest.global-setup';

export default async function globalSetup() {
  return setupTestDatabase('postgres');
}
