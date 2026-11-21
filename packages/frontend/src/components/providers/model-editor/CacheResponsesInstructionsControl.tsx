import {
  type AdapterEntry,
  CACHE_RESPONSES_INSTRUCTIONS_ADAPTER,
  getAdapterName,
  KNOWN_ADAPTERS,
} from './adapter-utils';

export function CacheResponsesInstructionsControl({
  entries,
  onChange,
}: {
  entries: AdapterEntry[];
  onChange: (entries: AdapterEntry[]) => void;
}) {
  const adapter = KNOWN_ADAPTERS.find(
    (item) => item.value === CACHE_RESPONSES_INSTRUCTIONS_ADAPTER
  )!;
  const entry = entries.findLast((item) => getAdapterName(item) === adapter.value);
  const mode = !entry ? '' : typeof entry === 'string' || entry.enabled !== false ? 'on' : 'off';

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        padding: '4px 8px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border-glass)',
        background: mode === '' ? 'var(--color-bg-glass)' : 'var(--color-bg-hover)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div>
        <div className="font-body text-text text-[12px] font-medium">{adapter.label}</div>
        <div className="font-body text-text-secondary text-[11px]" style={{ lineHeight: 1.35 }}>
          {adapter.description}
        </div>
      </div>
      <select
        aria-label={adapter.label}
        className="font-body text-text bg-bg-glass border-border-glass focus:border-primary w-full rounded-sm border py-1 pr-2 pl-2 text-[12px] outline-none"
        value={mode}
        onChange={(event) => {
          const withoutEntry = entries.filter((item) => getAdapterName(item) !== adapter.value);
          onChange(
            event.target.value === ''
              ? withoutEntry
              : [
                  ...withoutEntry,
                  { name: adapter.value, options: {}, enabled: event.target.value === 'on' },
                ]
          );
        }}
      >
        <option value="">Auto</option>
        <option value="on">Enabled</option>
        <option value="off">Disabled</option>
      </select>
    </div>
  );
}
