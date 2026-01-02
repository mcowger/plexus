import React, { useState } from 'react';

interface TooltipProps {
    content: React.ReactNode;
    children: React.ReactNode;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div 
            className="tooltip-container" 
            style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div 
                    className="tooltip-content"
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        marginTop: '8px',
                        padding: '8px',
                        backgroundColor: '#1e1e1e',
                        border: '1px solid var(--color-border)',
                        borderRadius: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        zIndex: 1000,
                        opacity: 1,
                        visibility: 'visible',
                        whiteSpace: 'pre-wrap',
                        minWidth: '200px',
                        maxWidth: '300px',
                        fontSize: '0.85em',
                        color: 'var(--color-text-primary)'
                    }}
                >
                    {content}
                </div>
            )}
        </div>
    );
};
