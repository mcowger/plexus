import React from 'react';
import { Tooltip } from './Tooltip';

interface CostToolTipProps {
    source: string;
    costMetadata?: string;
    children: React.ReactNode;
}

export const CostToolTip: React.FC<CostToolTipProps> = ({ source, costMetadata, children }) => {
    let content: React.ReactNode = 'No details';

    const containerStyle: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '12px',
        color: '#e0e0e0',
        minWidth: '180px'
    };

    const headerStyle: React.CSSProperties = {
        fontWeight: 'bold',
        borderBottom: '1px solid #4a4a4a',
        paddingBottom: '4px',
        marginBottom: '4px',
        // textTransform: 'capitalize'
    };

    const gridStyle: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: '60px 1fr',
        gap: '4px 12px',
        alignItems: 'center'
    };

    const labelStyle: React.CSSProperties = {
        color: '#9ca3af',
        textAlign: 'left'
    };

    const valueStyle: React.CSSProperties = {
        fontFamily: 'monospace',
        textAlign: 'right'
    };

    const formatRate = (val: any) => {
        if (val === undefined || val === null) return '0';
        const num = typeof val === 'string' ? parseFloat(val) : val;
        if (isNaN(num)) return String(val);
        if (num === 0) return '0';

        // Use toFixed with high precision to avoid scientific notation, then trim trailing zeros
        return num.toFixed(10).replace(/\.?0+$/, "");
    };

    try {
        const parsed = costMetadata ? JSON.parse(costMetadata) : {};
        const data = parsed || {};

        // Normalize source comparison
        const s = (source || '').toLowerCase();

        if (s === 'simple') {
            content = (
                <div style={containerStyle}>
                    <div style={headerStyle}>Source: Simple</div>
                    <div style={gridStyle}>
                        <span style={labelStyle}>Input:</span>
                        <span style={valueStyle}>{formatRate(data.input)}</span>

                        <span style={labelStyle}>Output:</span>
                        <span style={valueStyle}>{formatRate(data.output)}</span>

                        <span style={labelStyle}>Cached:</span>
                        <span style={valueStyle}>{formatRate(data.cached)}</span>
                    </div>
                </div>
            );
        } else if (s === 'defined') {
            // Handle both new (flat rates) and old (full config) formats
            const isNewFormat = data.input !== undefined;

            content = (
                <div style={containerStyle}>
                    <div style={headerStyle}>Source: Defined</div>
                    {isNewFormat ? (
                        <div style={gridStyle}>
                            <span style={labelStyle}>Input:</span>
                            <span style={valueStyle}>{formatRate(data.input)}</span>

                            <span style={labelStyle}>Output:</span>
                            <span style={valueStyle}>{formatRate(data.output)}</span>
                        </div>
                    ) : (
                        <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                            Range-based configuration
                        </div>
                    )}
                </div>
            );
        } else if (s === 'per_request') {
            content = (
                <div style={containerStyle}>
                 <div style={headerStyle}>Source: Per Request</div>
             <div style={gridStyle}>
                     <span style={labelStyle}>Amount:</span>
                    <span style={valueStyle}>${formatRate(data.amount)}</span>
               </div>
              <div style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: '11px', marginTop: '4px' }}>
              Flat fee per API call
                 </div>
                </div>
            );
        } else if (s === 'openrouter') {
            content = (
                <div style={containerStyle}>
                    <div style={headerStyle}>Pricing Source: OpenRouter</div>
                    <div style={{ ...headerStyle, borderBottom: 'none', fontSize: '11px', color: '#9ca3af' }}>{data.slug || "Unknown"}</div>
                    <div style={gridStyle}>
                        <span style={labelStyle}>Input:</span>
                        <span style={valueStyle}>{formatRate(data.prompt)}</span>

                        <span style={labelStyle}>Output:</span>
                        <span style={valueStyle}>{formatRate(data.completion)}</span>

                        <span style={labelStyle}>Cached:</span>
                        <span style={valueStyle}>{formatRate(data.input_cache_read)}</span>


                        <span style={{ ...labelStyle, color: '#4ade80' }}>Discounted:</span>
                        <span style={{ ...valueStyle, color: '#4ade80' }}>
                            {Number(data?.discount) > 0
                                ? `${(data.discount * 100).toFixed(0)}%`
                                : "None"
                            }
                        </span>


                    </div>
                </div>
            );
        } else {
            // Fallback for unknown sources
            content = (
                <div style={containerStyle}>
                    <div style={headerStyle}>Source: {source}</div>
                    <pre style={{ fontSize: '11px', overflow: 'auto' }}>{JSON.stringify(data, null, 2)}</pre>
                </div>
            );
        }

    } catch (e) {
        content = <span style={{ color: '#f87171' }}>Error parsing metadata</span>;
    }

    return (
        <Tooltip content={content}>
            {children}
        </Tooltip>
    );
};