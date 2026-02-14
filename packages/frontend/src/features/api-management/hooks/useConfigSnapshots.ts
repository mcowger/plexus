import { useState, useEffect, useCallback } from 'react';
import { api, type PlexusConfig } from '../../../lib/api';
import { parse, stringify } from 'yaml';

export interface ConfigSnapshot {
  id: string;
  name: string;
  description?: string;
  config: PlexusConfig;
  createdAt: string;
  updatedAt?: string;
}

export interface UseConfigSnapshotsReturn {
  snapshots: ConfigSnapshot[];
  loading: boolean;
  error: Error | null;
  saveSnapshot: (name: string, description?: string) => Promise<void>;
  restoreSnapshot: (id: string) => Promise<void>;
  deleteSnapshot: (id: string) => Promise<void>;
  exportSnapshot: (id: string) => void;
  importSnapshot: (file: File) => Promise<void>;
  refetch: () => Promise<void>;
}

const STORAGE_KEY = 'plexus_config_snapshots';

/**
 * useConfigSnapshots hook - Manage saved configuration snapshots
 *
 * This hook provides functionality to save, restore, delete, import, and export
 * Plexus configuration snapshots. Snapshots are stored in localStorage with
 * the actual config content, enabling easy rollback and version management.
 */
export function useConfigSnapshots(): UseConfigSnapshotsReturn {
  const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Load snapshots from localStorage on mount
  useEffect(() => {
    const loadSnapshots = () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setSnapshots(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to load snapshots from localStorage', e);
      }
    };

    loadSnapshots();
  }, []);

  // Persist snapshots to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    } catch (e) {
      console.error('Failed to save snapshots to localStorage', e);
      // If localStorage is full, we might want to warn the user
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        setError(new Error('Storage quota exceeded. Please delete some snapshots.'));
      }
    }
  }, [snapshots]);

  const saveSnapshot = useCallback(async (name: string, description?: string) => {
    setLoading(true);
    setError(null);

    try {
      // Fetch current config from server
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as PlexusConfig;

      const newSnapshot: ConfigSnapshot = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: name.trim(),
        description: description?.trim(),
        config,
        createdAt: new Date().toISOString(),
      };

      setSnapshots((prev) => [newSnapshot, ...prev]);
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Failed to save snapshot');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const restoreSnapshot = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = snapshots.find((s) => s.id === id);
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      // Convert config to YAML and save to server
      const configYaml = stringify(snapshot.config);
      await api.saveConfig(configYaml);
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Failed to restore snapshot');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [snapshots]);

  const deleteSnapshot = useCallback(async (id: string) => {
    setError(null);

    try {
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Failed to delete snapshot');
      setError(error);
      throw error;
    }
  }, []);

  const exportSnapshot = useCallback((id: string) => {
    const snapshot = snapshots.find((s) => s.id === id);
    if (!snapshot) {
      throw new Error('Snapshot not found');
    }

    const exportData = {
      name: snapshot.name,
      description: snapshot.description,
      createdAt: snapshot.createdAt,
      config: snapshot.config,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `plexus-config-${snapshot.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [snapshots]);

  const importSnapshot = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);

    try {
      const content = await file.text();
      const imported = JSON.parse(content);

      // Validate imported data structure
      if (!imported.config || typeof imported.config !== 'object') {
        throw new Error('Invalid config snapshot file: missing or invalid config');
      }

      const newSnapshot: ConfigSnapshot = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: imported.name || `Imported ${new Date().toLocaleString()}`,
        description: imported.description,
        config: imported.config as PlexusConfig,
        createdAt: new Date().toISOString(),
        updatedAt: imported.createdAt,
      };

      setSnapshots((prev) => [newSnapshot, ...prev]);
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Failed to import snapshot');
      setError(error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    // Snapshots are loaded from localStorage, so this is a no-op
    // but useful for consistency with other hooks
    setLoading(false);
  }, []);

  return {
    snapshots,
    loading,
    error,
    saveSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    exportSnapshot,
    importSnapshot,
    refetch,
  };
}

export default useConfigSnapshots;
