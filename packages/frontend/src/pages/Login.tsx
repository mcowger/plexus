import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setError('Please enter an Admin Key');
      return;
    }
    login(key.trim());
    // Navigation will happen via the useEffect above once isAuthenticated becomes true
  };

  return (
    <div className="min-h-screen bg-bg-deep flex items-center justify-center p-4">
      <div className="w-full" style={{ maxWidth: '600px' }}>
        <div className="text-center mb-8">
                      <img src="/ui/plexus_logo_transparent.png" alt="Plexus" className="h-16 mx-auto mb-4" />          <h1 className="text-2xl font-bold text-text">Admin Access</h1>
          <p className="text-text-muted">Enter your Admin Key to continue</p>
        </div>
        
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="adminKey" className="block text-sm font-medium text-text-muted mb-1">
                Admin Key
              </label>
              <Input
                id="adminKey"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-admin-..."
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
