import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '../metrics/Spinner';

describe('Spinner', () => {
  it('renders with percentage display', () => {
    render(<Spinner value={75} max={100} />);

    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('calculates percentage correctly', () => {
    render(<Spinner value={50} max={200} />);

    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('clamps to 100%', () => {
    render(<Spinner value={150} max={100} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('clamps to 0%', () => {
    render(<Spinner value={-10} max={100} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('uses custom size', () => {
    const { container } = render(<Spinner value={50} max={100} size={200} />);

    const spinner = container.firstChild as HTMLElement;
    expect(spinner).toHaveStyle({ width: '200px', height: '200px' });
  });

  it('handles zero max gracefully', () => {
    render(<Spinner value={50} max={0} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
