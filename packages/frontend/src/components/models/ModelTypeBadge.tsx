import React from 'react';
import { Badge as UIBadge } from '../ui/Badge';
import { Alias } from '../../lib/api';

interface ModelTypeBadgeProps {
  type?: Alias['type'];
  className?: string;
}

export const ModelTypeBadge: React.FC<ModelTypeBadgeProps> = ({ type, className }) => {
  const label = type || 'text';

  let status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'neutral' | 'warning' =
    'neutral';
  let customClass = '';

  switch (type) {
    case 'embeddings':
      status = 'connected'; // green
      break;
    case 'transcriptions':
      customClass = 'text-purple-400 border-purple-500/30 bg-purple-500/15'; // purple
      break;
    case 'speech':
      customClass = 'text-orange-400 border-orange-500/30 bg-orange-500/15'; // orange
      break;
    case 'image':
      customClass = 'text-pink-400 border-pink-500/30 bg-pink-500/15'; // pink
      break;
    default:
      customClass = 'text-gray-400 border-gray-500/30 bg-gray-500/15';
  }

  return (
    <UIBadge
      status={status}
      className={`${customClass} ${className} gap-1 px-2 py-0.5 rounded uppercase tracking-wider text-[10px]`}
    >
      {label}
    </UIBadge>
  );
};
