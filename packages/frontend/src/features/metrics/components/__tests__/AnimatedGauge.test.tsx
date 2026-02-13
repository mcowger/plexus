import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnimatedGauge } from '../metrics/AnimatedGauge';

describe('AnimatedGauge', () => {
  it('renders with correct value and label', () => {
    render(<AnimatedGauge value={50} max={100} label="Test Gauge" />);

    expect(screen.getByText('50.0')).toBeInTheDocument();
    expect(screen.getByText('TEST GAUGE')).toBeInTheDocument();
  });

  it('clamps value to max', () => {
    render(<AnimatedGauge value={150} max={100} label="Clamped" />);

    // Value should be clamped to 100%
    expect(screen.getByText('150.0')).toBeInTheDocument();
  });

  it('clamps value to minimum of 0', () => {
    render(<AnimatedGauge value={-10} max={100} label="Min Test" />);

    expect(screen.getByText('-10.0')).toBeInTheDocument();
  });

  it('displays unit when provided', () => {
    render(<AnimatedGauge value={75} max={100} label="Speed" unit="%" />);

    expect(screen.getByText('75.0')).toBeInTheDocument();
  });

  it('applies different colors based on percentage', () => {
    const { rerender } = render(<AnimatedGauge value={30} max={100} label="Low" />);
    // Green zone (< 60%)

    rerender(<AnimatedGauge value={70} max={100} label="Medium" />);
    // Yellow zone (60-80%)

    rerender(<AnimatedGauge value={90} max={100} label="High" />);
    // Red zone (> 80%)

    expect(screen.getByText('90.0')).toBeInTheDocument();
  });
});
