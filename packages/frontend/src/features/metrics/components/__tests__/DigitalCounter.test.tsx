import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DigitalCounter } from '../metrics/DigitalCounter';

describe('DigitalCounter', () => {
  it('renders with correct value and label', () => {
    render(<DigitalCounter value={1234} label="Requests" />);

    expect(screen.getByText('001234')).toBeInTheDocument();
    expect(screen.getByText('REQUESTS')).toBeInTheDocument();
  });

  it('pads value to 6 digits', () => {
    render(<DigitalCounter value={42} label="Test" />);

    expect(screen.getByText('000042')).toBeInTheDocument();
  });

  it('handles large values', () => {
    render(<DigitalCounter value={1234567} label="Large" />);

    expect(screen.getByText('1234567')).toBeInTheDocument();
  });

  it('applies custom color', () => {
    const { container } = render(
      <DigitalCounter value={100} label="Custom" color="#ff0000" />
    );

    const counter = container.querySelector('.font-mono');
    expect(counter).toHaveStyle({ color: '#ff0000' });
  });

  it('handles zero value', () => {
    render(<DigitalCounter value={0} label="Empty" />);

    expect(screen.getByText('000000')).toBeInTheDocument();
  });
});
