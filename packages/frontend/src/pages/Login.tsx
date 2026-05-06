import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, AlertCircle, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/Button';
import { PlexusMark } from '../components/layout/PlexusMark';

export const Login: React.FC = () => {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';
  const appVersion: string =
    // @ts-expect-error — replaced at build time by build.ts
    process.env.APP_VERSION || 'dev';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setError('Please enter a key');
      return;
    }
    const valid = await login(key.trim());
    if (!valid) {
      setError('Invalid key. Verify the prefix and try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deep p-4 sm:p-6">
      {/* Background mesh */}
      <div className="fixed inset-0 pointer-events-none opacity-50" aria-hidden="true">
        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
          <g stroke="rgba(245,158,11,0.10)" strokeWidth="0.5" fill="none">
            <path d="M0 200 C 200 100, 600 300, 800 180" />
            <path d="M0 320 C 220 220, 580 420, 800 300" />
            <path d="M0 440 C 200 340, 600 540, 800 420" />
          </g>
          <circle cx="160" cy="200" r="3" fill="#F59E0B" opacity="0.7" />
          <circle cx="380" cy="260" r="3" fill="#FBBF24" opacity="0.7" />
          <circle cx="640" cy="220" r="3" fill="#F59E0B" opacity="0.7" />
          <circle cx="240" cy="380" r="3" fill="#FBBF24" opacity="0.5" />
          <circle cx="560" cy="420" r="3" fill="#F59E0B" opacity="0.5" />
        </svg>
      </div>

      <main className="relative w-full max-w-md">
        {/* Logo + wordmark */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-3 sm:mb-8">
          <div className="animate-float">
            <PlexusMark size={44} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold amber-grad-text font-heading tracking-tight">
              Plexus
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-mono">
              {appVersion}
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="glass-bg rounded-xl p-5 shadow-2xl sm:rounded-2xl sm:p-8">
          <div className="mb-6">
            <h1 className="font-heading text-2xl font-semibold tracking-tight mb-1.5">Sign in</h1>
            <p className="text-sm text-text-secondary leading-relaxed">
              Enter your admin key for full access, or an API key secret for a scoped view of your
              key's activity.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <input
              type="text"
              name="username"
              autoComplete="username"
              defaultValue="admin"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <div>
              <label
                htmlFor="adminKey"
                className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider"
              >
                Admin key or API key secret
              </label>
              <div className="relative">
                <KeyRound
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                />
                <input
                  id="adminKey"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="sk-admin-•••• or sk-•••••••••••••"
                  autoFocus
                  className="w-full bg-slate-900/60 border border-border rounded-md py-3 pl-10 pr-10 text-text font-mono text-sm placeholder:text-text-muted hover:border-border-2 focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.18)] focus:outline-none transition-all duration-fast"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-slate-700/50 text-text-secondary"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {error && (
                <div className="mt-2 flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
                  <AlertCircle size={14} className="mt-0.5 flex-none" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <Button type="submit" variant="primary" className="w-full py-3 text-sm font-semibold">
              <span>Access Dashboard</span>
              <ArrowRight size={14} />
            </Button>
          </form>

          <div className="mt-6 flex flex-col gap-2 border-t border-white/5 pt-5 text-[11px] text-text-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={14} />
              End-to-end encrypted
            </span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-text-muted">
          © 2026 Plexus · Unified LLM Gateway
        </p>
      </main>
    </div>
  );
};
