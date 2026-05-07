import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { clsx } from 'clsx';

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function parseValue(v: string): { date: Date | null; hours: string; minutes: string } {
  if (!v) return { date: null, hours: '00', minutes: '00' };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { date: null, hours: '00', minutes: '00' };
  return { date: d, hours: pad(d.getHours()), minutes: pad(d.getMinutes()) };
}

function toISOStringLocal(date: Date, hours: string, minutes: string): string {
  const d = new Date(date);
  d.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hours}:${minutes}`;
}

export const DateTimePicker: React.FC<DateTimePickerProps> = ({
  value,
  onChange,
  placeholder = 'Select date...',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const parsed = parseValue(value);
  const [viewDate, setViewDate] = useState(() => parsed.date ?? new Date());
  const [hours, setHours] = useState(parsed.hours);
  const [minutes, setMinutes] = useState(parsed.minutes);
  const ref = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const p = parseValue(value);
    if (p.date) setViewDate(p.date);
    setHours(p.hours);
    setMinutes(p.minutes);
  }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        popupRef.current &&
        !popupRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const selectedDate = parsed.date;

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const selectDay = (day: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const formatted = toISOStringLocal(newDate, hours, minutes);
    onChange(formatted);
    setViewDate(newDate);
  };

  const applyTime = (h: string, m: string) => {
    const baseDate = selectedDate ?? new Date(viewDate);
    const formatted = toISOStringLocal(baseDate, h, m);
    onChange(formatted);
  };

  const displayValue = value
    ? (() => {
        const d = parseValue(value);
        if (!d.date) return value;
        return `${d.date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })} ${d.hours}:${d.minutes}`;
      })()
    : '';

  const popup = (
    <div
      ref={(el) => {
        popupRef.current = el;
        if (el && ref.current) {
          const rect = ref.current.getBoundingClientRect();
          el.style.top = `${rect.bottom + window.scrollY + 8}px`;
          el.style.left = `${rect.left + window.scrollX}px`;
        }
      }}
      className="fixed p-3 rounded-lg border border-border-glass shadow-modal"
      style={{
        zIndex: 500,
        backgroundColor: 'var(--color-bg-card)',
        backdropFilter: 'blur(16px)',
        minWidth: '280px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-text">
          {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text transition-colors"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day labels */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-text-muted py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="aspect-square" />;

          const isSelected =
            selectedDate &&
            selectedDate.getDate() === day &&
            selectedDate.getMonth() === month &&
            selectedDate.getFullYear() === year;

          return (
            <button
              key={day}
              type="button"
              onClick={() => selectDay(day)}
              className={clsx(
                'aspect-square flex items-center justify-center rounded text-[13px] transition-colors',
                isSelected ? 'bg-primary text-black font-semibold' : 'text-text hover:bg-bg-hover'
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Time selector */}
      <div className="mt-3 pt-3 border-t border-border-glass flex items-center gap-2">
        <Clock size={14} className="text-text-secondary shrink-0" />
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={23}
            value={hours}
            onChange={(e) => {
              let v = e.target.value.replace(/\D/g, '').slice(0, 2);
              if (v && parseInt(v, 10) > 23) v = '23';
              setHours(v);
              if (v.length === 2) applyTime(v, minutes);
            }}
            onBlur={() => {
              const v = pad(Math.max(0, Math.min(23, parseInt(hours || '0', 10))));
              setHours(v);
              applyTime(v, minutes);
            }}
            className="w-12 text-center py-1 rounded bg-bg-glass border border-border-glass text-text text-sm outline-none focus:border-primary"
          />
          <span className="text-text-secondary">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => {
              let v = e.target.value.replace(/\D/g, '').slice(0, 2);
              if (v && parseInt(v, 10) > 59) v = '59';
              setMinutes(v);
              if (v.length === 2) applyTime(hours, v);
            }}
            onBlur={() => {
              const v = pad(Math.max(0, Math.min(59, parseInt(minutes || '0', 10))));
              setMinutes(v);
              applyTime(hours, v);
            }}
            className="w-12 text-center py-1 rounded bg-bg-glass border border-border-glass text-text text-sm outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={clsx(
          'w-full sm:w-56 flex items-center gap-2 py-2.5 pl-3 pr-3',
          'font-body text-sm text-left rounded-md border outline-none transition-all duration-fast',
          'backdrop-blur-md bg-bg-glass border-border-glass text-text',
          'hover:border-text-secondary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25'
        )}
      >
        <Calendar size={14} className="shrink-0 text-text-secondary" />
        <span className={clsx('flex-1 truncate', !displayValue && 'text-text-muted')}>
          {displayValue || placeholder}
        </span>
        {value && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="cursor-pointer text-text-muted hover:text-text transition-colors"
            role="button"
            aria-label="Clear"
          >
            <X size={12} />
          </span>
        )}
      </button>

      {open && createPortal(popup, document.body)}
    </div>
  );
};
