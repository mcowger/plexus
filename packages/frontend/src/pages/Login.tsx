import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { FormField } from '../components/ui/FormField';
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
  };

  return (
    <div className="min-h-screen bg-bg-deep flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logo} alt="Plexus" className="h-14 sm:h-16 mx-auto mb-4" />
          <h1 className="font-heading text-h1 font-bold text-text m-0">Sign in</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Enter your admin key for full access, or an API key secret for a scoped view of your
            key's activity.
          </p>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              type="text"
              name="username"
              autoComplete="username"
              defaultValue="admin"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <FormField label="Admin key or API key secret" htmlFor="adminKey" error={error || undefined}>
              <Input
                id="adminKey"
                type="password"
                autoComplete="current-password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  if (error) setError('');
                }}
                placeholder="sk-admin-... or sk-..."
                autoFocus
              />
            </FormField>

            <Button type="submit" className="w-full">
              Access Dashboard
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
};
