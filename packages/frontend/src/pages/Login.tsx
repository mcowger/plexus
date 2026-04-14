import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import logo from '../assets/plexus_logo_transparent.png';

export const Login: React.FC = () => {
  const [key, setKey] = useState('');
  const { login, isAuthenticated } = useAuth();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';

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
      setError('Invalid key');
    }
    // On success, navigation happens via the useEffect above once isAuthenticated becomes true
  };

  return (
    <div className="min-h-screen bg-bg-deep flex items-center justify-center p-4">
      <div className="w-full" style={{ maxWidth: '600px' }}>
        <div className="text-center mb-8">
          <img src={logo} alt="Plexus" className="h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-text">Sign in</h1>
          <p className="text-text-muted">
            Enter your admin key for full access, or an API key secret for a scoped view of your
            key's activity.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <label htmlFor="adminKey" className="block text-sm font-medium text-text-muted mb-1">
                Admin key or API key secret
              </label>
              <Input
                id="adminKey"
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-admin-... or sk-..."
                autoFocus
              />
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}

            <Button type="submit" className="w-full">
              Access Dashboard
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
