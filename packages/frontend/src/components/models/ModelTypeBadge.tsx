import React from 'react';
import { Badge as UIBadge } from '../ui/Badge';
import { Alias } from '../../lib/api';
import { useT } from '../../i18n';

interface ModelTypeBadgeProps {
  type?: Alias['type'];
  className?: string;
}

const TYPE_KEYS = [
  'chat',
  'embeddings',
  'transcriptions',
  'speech',
  'image',
  'responses',
] as const satisfies readonly Alias['type'][];

export const ModelTypeBadge: React.FC<ModelTypeBadgeProps> = ({ type, className }) => {
  const { t } = useT('models.modal.types');
  const normalized = type ?? 'chat';
  const typeKey = (TYPE_KEYS as readonly string[]).includes(normalized)
    ? (normalized as (typeof TYPE_KEYS)[number])
    : 'chat';
  const translated = t(typeKey);

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
    case 'responses':
      customClass = 'text-cyan-400 border-cyan-500/30 bg-cyan-500/15'; // cyan
      break;
    default:
      customClass = 'text-gray-400 border-gray-500/30 bg-gray-500/15';
  }

  return (
    <UIBadge
      status={status}
      className={`${customClass} ${className} gap-1 px-2 py-0.5 rounded uppercase tracking-wider text-[10px]`}
    >
      {translated}
    </UIBadge>
  );
};
