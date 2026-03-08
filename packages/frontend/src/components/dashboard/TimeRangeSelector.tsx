import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Calendar, ChevronDown } from 'lucide-react';
import {
  getPresetRange,
  formatDateRange,
  isValidDateRange,
  parseISODate,
  formatISODate,
  type DateRangePreset,
  type CustomDateRange,
} from '../../lib/date';

type TimeRange = 'live' | 'hour' | 'day' | 'week' | 'month' | 'custom';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  options?: TimeRange[];
  customRange?: CustomDateRange | null;
  onCustomRangeChange?: (range: CustomDateRange | null) => void;
}

const PRESETS: { label: string; value: DateRangePreset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'this-week' },
  { label: 'This Month', value: 'this-month' },
  { label: 'Last Month', value: 'last-month' },
];

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  value,
  onChange,
  options = ['hour', 'day', 'week', 'month', 'custom'],
  customRange,
  onCustomRangeChange,
}) => {
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [showPresetDropdown, setShowPresetDropdown] = useState(false);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPresetDropdown(false);
      }
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowCustomPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initialize date inputs when custom range changes
  useEffect(() => {
    if (customRange && value === 'custom') {
      setStartDate(formatDateTimeLocal(customRange.start));
      setEndDate(formatDateTimeLocal(customRange.end));
      setError(null);
    }
  }, [customRange, value]);

  const handlePresetSelect = (preset: DateRangePreset) => {
    const range = getPresetRange(preset);
    setStartDate(formatDateTimeLocal(range.start));
    setEndDate(formatDateTimeLocal(range.end));
    onCustomRangeChange?.(range);
    setShowPresetDropdown(false);
    setError(null);
  };

  const handleDateChange = (field: 'start' | 'end', value: string) => {
    if (field === 'start') {
      setStartDate(value);
    } else {
      setEndDate(value);
    }

    const newStart = field === 'start' ? parseISODate(value) : customRange?.start;
    const newEnd = field === 'end' ? parseISODate(value) : customRange?.end;

    if (newStart && newEnd) {
      if (!isValidDateRange(newStart, newEnd)) {
        setError('End date must be after start date and not in the future');
        return;
      }
      setError(null);
      onCustomRangeChange?.({ start: newStart, end: newEnd });
    }
  };

  const handleCustomClick = () => {
    if (value === 'custom') {
      setShowCustomPicker(!showCustomPicker);
    } else {
      onChange('custom');
      setShowCustomPicker(true);
      // Initialize with last 7 days if no custom range exists
      if (!customRange) {
        const now = new Date();
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        onCustomRangeChange?.({ start: weekAgo, end: now });
      }
    }
    setShowPresetDropdown(false);
  };

  const formatDateTimeLocal = (date: Date): string => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  };

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      {options.map((range) => {
        if (range === 'custom') {
          return (
            <div key={range} style={{ position: 'relative' }} ref={pickerRef}>
              <Button
                size="sm"
                variant={value === range ? 'primary' : 'secondary'}
                onClick={handleCustomClick}
                style={{
                  textTransform: 'capitalize',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Calendar size={14} />
                Custom
                <ChevronDown
                  size={12}
                  style={{
                    transition: 'transform 0.2s',
                    transform: showCustomPicker ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              </Button>

              {showCustomPicker && value === 'custom' && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '8px',
                    padding: '12px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    zIndex: 1000,
                    minWidth: '280px',
                  }}
                >
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <button
                        onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          backgroundColor: 'var(--bg-hover)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>Quick Select</span>
                        <ChevronDown
                          size={14}
                          style={{
                            transition: 'transform 0.2s',
                            transform: showPresetDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                          }}
                        />
                      </button>
                    </div>

                    {showPresetDropdown && (
                      <div
                        ref={dropdownRef}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          marginBottom: '12px',
                        }}
                      >
                        {PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            onClick={() => handlePresetSelect(preset.value)}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: 'transparent',
                              border: 'none',
                              borderRadius: '4px',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor = 'transparent')
                            }
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                        }}
                      >
                        Start Date
                      </label>
                      <input
                        type="datetime-local"
                        value={startDate}
                        onChange={(e) => handleDateChange('start', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          backgroundColor: 'var(--bg-input)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: '4px',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                        }}
                      />
                    </div>

                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                        }}
                      >
                        End Date
                      </label>
                      <input
                        type="datetime-local"
                        value={endDate}
                        onChange={(e) => handleDateChange('end', e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 8px',
                          backgroundColor: 'var(--bg-input)',
                          border: '1px solid var(--border-glass)',
                          borderRadius: '4px',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                        }}
                      />
                    </div>

                    {error && (
                      <div
                        style={{
                          padding: '6px 8px',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '4px',
                          color: 'var(--danger)',
                          fontSize: '12px',
                        }}
                      >
                        {error}
                      </div>
                    )}

                    <div
                      style={{
                        padding: '6px 8px',
                        backgroundColor: 'var(--bg-hover)',
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {customRange && formatDateRange(customRange.start, customRange.end)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        }

        return (
          <Button
            key={range}
            size="sm"
            variant={value === range ? 'primary' : 'secondary'}
            onClick={() => {
              onChange(range);
              setShowCustomPicker(false);
              setShowPresetDropdown(false);
            }}
            style={{ textTransform: 'capitalize' }}
          >
            {range}
          </Button>
        );
      })}
    </div>
  );
};
