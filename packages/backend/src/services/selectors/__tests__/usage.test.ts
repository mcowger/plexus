import { describe, expect, it, mock } from 'bun:test';
import { UsageSelector } from '../usage';
import { UsageStorageService } from '../../usage-storage';
import { ModelTarget } from '../../../config';

describe('UsageSelector', () => {
  const mockGetUsage = mock((filters: any, pagination: any): Promise<any> => Promise.resolve({ data: [], total: 0 }));
  const mockStorage = {
    getUsage: mockGetUsage
  } as unknown as UsageStorageService;

  const selector = new UsageSelector(mockStorage);

  it('should return null for empty targets', async () => {
    expect(await selector.select([])).toBeNull();
  });

  it('should return the single target if only one exists', async () => {
    const targets: ModelTarget[] = [{ provider: 'p1', model: 'm1' }];
    expect(await selector.select(targets)).toEqual(targets[0] || null);
  });

  it('should select the least used target based on recent usage count', async () => {
    mockGetUsage.mockImplementation((filters: any, pagination: any) => {
      const provider = filters?.provider;
      if (provider === 'p1') return Promise.resolve({ data: [], total: 100 }); // Most used
      if (provider === 'p2') return Promise.resolve({ data: [], total: 10 });  // Least used
      if (provider === 'p3') return Promise.resolve({ data: [], total: 50 });  // Middle
      return Promise.resolve({ data: [], total: 0 });
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' },
      { provider: 'p3', model: 'm3' }
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 is least used
  });

  it('should handle targets with no usage data (0 count)', async () => {
    mockGetUsage.mockImplementation((filters: any, pagination: any) => {
      const provider = filters?.provider;
      if (provider === 'p1') return Promise.resolve({ data: [], total: 50 });
      if (provider === 'p2') return Promise.resolve({ data: [], total: 0 }); // No usage
      return Promise.resolve({ data: [], total: 0 });
    });

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' }
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[1]!); // p2 has no usage
  });

  it('should handle all targets having equal usage (first one wins)', async () => {
    mockGetUsage.mockImplementation(() => Promise.resolve({ data: [], total: 10 }));

    const targets: ModelTarget[] = [
      { provider: 'p1', model: 'm1' },
      { provider: 'p2', model: 'm2' }
    ];

    const selected = await selector.select(targets);
    expect(selected).toEqual(targets[0]!);
  });

});
