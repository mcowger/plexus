import React, { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Check, ChevronsUpDown } from 'lucide-react';

interface OpenRouterSlugInputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}

export const OpenRouterSlugInput: React.FC<OpenRouterSlugInputProps> = ({
  label,
  placeholder,
  value,
  onChange,
}) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Sync internal state with prop value
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!inputValue || inputValue.length < 2) {
        setSuggestions([]);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(`/v1/openrouter/models?q=${encodeURIComponent(inputValue)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.data || []);
          setSelectedIndex(-1);
        }
      } catch (error) {
        console.error('Error fetching OpenRouter models:', error);
        setSuggestions([]);
      } finally {
        setIsLoading(false);
      }
    };

    const debounceTimer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(debounceTimer);
  }, [inputValue]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault();
        setShowSuggestions(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          selectSuggestion(suggestions[selectedIndex]);
        }
        break;
      case 'Escape':
        setShowSuggestions(false);
        break;
    }
  };

  const selectSuggestion = (slug: string) => {
    setInputValue(slug);
    onChange(slug);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
    if (newValue.length >= 2) {
      setShowSuggestions(true);
    }
  };

  const toggleDropdown = () => {
    if (showSuggestions) {
      setShowSuggestions(false);
    } else {
      setShowSuggestions(true);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-2 relative">
      {label && (
        <label className="font-body text-[13px] font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="w-full py-2.5 px-3.5 pr-10 font-body text-sm text-text bg-bg-glass border border-border-glass rounded-sm outline-none transition-all duration-200 backdrop-blur-md focus:border-primary focus:shadow-[0_0_0_3px_rgba(245,158,11,0.15)]"
          placeholder={placeholder}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && inputValue.length >= 2) {
              setShowSuggestions(true);
            }
          }}
        />
        <button
          type="button"
          onClick={toggleDropdown}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-bg-subtle rounded transition-colors"
        >
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <ChevronsUpDown className="w-4 h-4 text-text-secondary" />
          )}
        </button>
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-bg-glass border border-border-glass rounded-sm shadow-lg backdrop-blur-md z-50 max-h-60 overflow-y-auto"
        >
          {suggestions.map((slug, index) => {
            const isSelected = slug === value;
            const isHighlighted = index === selectedIndex;
            
            return (
              <div
                key={slug}
                className={clsx(
                  'px-3.5 py-2.5 cursor-pointer font-body text-sm transition-colors flex items-center justify-between',
                  isHighlighted
                    ? 'bg-primary/20 text-text'
                    : 'text-text-secondary hover:bg-bg-subtle hover:text-text'
                )}
                onClick={() => selectSuggestion(slug)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={clsx(isSelected && 'font-medium text-text')}>{slug}</span>
                {isSelected && <Check className="w-4 h-4 text-primary" />}
              </div>
            );
          })}
        </div>
      )}
      {showSuggestions && suggestions.length === 0 && !isLoading && inputValue.length >= 2 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-bg-glass border border-border-glass rounded-sm shadow-lg backdrop-blur-md z-50 px-3.5 py-2.5"
        >
          <span className="font-body text-sm text-text-secondary italic">No models found matching "{inputValue}"</span>
        </div>
      )}
    </div>
  );
};
