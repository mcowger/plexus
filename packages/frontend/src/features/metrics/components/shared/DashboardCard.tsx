import React from 'react';
import { Card } from '../../../../components/ui/Card';

interface DashboardCardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  extra?: React.ReactNode;
  loading?: boolean;
}

export const DashboardCard: React.FC<DashboardCardProps> = ({
  title,
  children,
  className,
  extra,
  loading = false
}) => {
  return (
    <Card title={title} extra={extra} className={className}>
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-bg-hover rounded w-3/4"></div>
          <div className="h-4 bg-bg-hover rounded w-1/2"></div>
          <div className="h-4 bg-bg-hover rounded w-5/6"></div>
        </div>
      ) : (
        children
      )}
    </Card>
  );
};
