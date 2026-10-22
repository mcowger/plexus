import {
  AudioLines,
  BadgeQuestionMark,
  Disc,
  Gavel,
  Image as ImageIcon,
  ShieldCheck,
  Variable,
  Volume2,
} from 'lucide-react';
import React from 'react';

import { formatApiTypeLabel, getApiBaseType } from '../../lib/apiFormats';
import { API_LOGOS } from './constants';
import { isDecisionsApiType } from './helpers';

interface ApiTypeIconProps {
  apiType?: string | null;
  /** Edge length of the rendered icon in pixels. */
  size: number;
}

export const ApiTypeIcon: React.FC<ApiTypeIconProps> = ({ apiType, size }) => {
  if (!apiType) return <span className="text-text-muted text-[10px]">?</span>;
  if (apiType === 'embeddings') return <Variable size={size} className="text-green-500" />;
  if (apiType === 'transcriptions') return <AudioLines size={size} className="text-purple-500" />;
  if (apiType === 'speech') return <Volume2 size={size} className="text-orange-500" />;
  if (apiType === 'images') return <ImageIcon size={size} className="text-fuchsia-500" />;
  if (apiType === 'completions') return <Disc size={size} className="text-blue-500" />;
  if (apiType === 'raw') return <BadgeQuestionMark size={size} className="text-cyan-400" />;
  if (isDecisionsApiType(apiType)) return <Gavel size={size} className="text-sky-500" />;
  if (apiType === 'oauth') return <ShieldCheck size={size} className="text-emerald-500" />;

  const logo = API_LOGOS[getApiBaseType(apiType)];
  if (logo) {
    const label = formatApiTypeLabel(apiType);
    return <img src={logo} alt={label} title={label} width={size} height={size} />;
  }

  return <span className="text-text-muted text-[10px]">?</span>;
};
