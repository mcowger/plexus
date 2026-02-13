import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangeSelector } from '../usage/TimeRangeSelector';

describe('TimeRangeSelector', () => {
  it('renders all time range options', () => {
    render(<TimeRangeSelector value="day" onChange={() => {}} />);

    expect(screen.getByText('Hour')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
  });

  it('highlights selected value', () => {
    const { container } = render(
      <TimeRangeSelector value="week" onChange={() => {}} />
    );

    const weekButton = screen.getByText('Week');
    expect(weekButton).toHaveAttribute('data-variant', 'primary');
  });

  it('calls onChange when button clicked', () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="day" onChange={onChange} />);

    fireEvent.click(screen.getByText('Week'));
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('has correct label', () => {
    render(<TimeRangeSelector value="day" onChange={() => {}} />);

    expect(screen.getByText('Time Range')).toBeInTheDocument();
  });
});
