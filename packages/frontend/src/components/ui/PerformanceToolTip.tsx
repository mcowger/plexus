import React from 'react';
import { Tooltip } from './Tooltip';

interface PerformanceToolTipProps {
  duration: string;
  semanticBytes: string;
  rawBytes?: string;
  bytesPerSec?: string;
  estimatedTokensPerSec?: string;
  children: React.ReactNode;
}

export const PerformanceToolTip: React.FC<PerformanceToolTipProps> = ({
  duration,
  semanticBytes,
  rawBytes,
  bytesPerSec,
  estimatedTokensPerSec,
  children,
}) => {
  const rows = [
    ['Duration:', duration],
    ['Token bytes:', semanticBytes],
    ...(rawBytes ? [['Raw bytes:', rawBytes]] : []),
    ...(bytesPerSec ? [['Throughput:', `${bytesPerSec}/s`]] : []),
    ...(estimatedTokensPerSec ? [['Est. tok/s:', estimatedTokensPerSec]] : []),
  ];

  return (
    <Tooltip
      content={
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto',
            gap: '4px 12px',
            minWidth: '180px',
            fontSize: '12px',
          }}
        >
          <strong
            style={{
              gridColumn: '1 / -1',
              borderBottom: '1px solid #4a4a4a',
              paddingBottom: '4px',
              marginBottom: '2px',
            }}
          >
            Live performance
          </strong>
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <span style={{ color: '#9ca3af' }}>{label}</span>
              <span style={{ fontFamily: 'monospace', textAlign: 'right' }}>{value}</span>
            </React.Fragment>
          ))}
        </div>
      }
    >
      {children}
    </Tooltip>
  );
};
