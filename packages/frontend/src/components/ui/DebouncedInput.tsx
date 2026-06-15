import React, { useState, useEffect } from 'react';
import { Input } from './Input';

interface DebouncedInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'onChange' | 'value'> {
  value: string;
  onChange: (val: string) => void;
  debounce?: number;
}

export const DebouncedInput: React.FC<DebouncedInputProps> = ({
  value,
  onChange,
  debounce = 300,
  ...props
}) => {
  const [localVal, setLocalVal] = useState(value);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localVal !== value) {
        onChange(localVal);
      }
    }, debounce);

    return () => clearTimeout(timer);
  }, [localVal, debounce, onChange, value]);

  return <Input {...props} value={localVal} onChange={(e) => setLocalVal(e.target.value)} />;
};
