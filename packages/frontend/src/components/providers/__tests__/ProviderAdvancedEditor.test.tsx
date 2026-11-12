import { afterAll, afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useHappyDom } from '../../../../test/happydom';
import { api, type Provider } from '../../../lib/api';
import { ProviderAdvancedEditor } from '../ProviderAdvancedEditor';

useHappyDom();

// React 19 refuses to flush act() updates without this flag in a non-RTL setup.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

afterAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

const TOOL_ID_LABEL = 'Anthropic Tool-ID Normalization';
const DROP_THINKING_LABEL = 'Drop Unsigned Thinking';

/** An Anthropic-compatible gateway on a non-Anthropic host: nothing auto-fires. */
function makeProvider(adapter: any[] = []): Provider {
  return {
    id: 'custom-gw',
    name: 'Custom Gateway',
    type: ['messages'],
    apiBaseUrl: 'https://gateway.internal/anthropic',
    enabled: true,
    adapter,
  } as unknown as Provider;
}

/** Stateful parent: the editor owns no state, so the test supplies a real setter. */
function Harness({
  initial,
  onCommit,
}: {
  initial: Provider;
  onCommit: (provider: Provider) => void;
}) {
  const [provider, setProvider] = useState<Provider>(initial);
  const setEditingProvider: React.Dispatch<React.SetStateAction<Provider>> = (next) => {
    const resolved =
      typeof next === 'function' ? (next as (previous: Provider) => Provider)(provider) : next;
    onCommit(resolved);
    setProvider(resolved);
  };
  return (
    <ProviderAdvancedEditor
      editingProvider={provider}
      setEditingProvider={setEditingProvider}
      addKV={() => {}}
      updateKV={() => {}}
      removeKV={() => {}}
    />
  );
}

describe('ProviderAdvancedEditor — automatically injected Anthropic adapters', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: Provider;

  beforeEach(() => {
    // The editor probes the pi-ai provider list on mount; never let it hit the network.
    spyOn(api, 'getPiProviders').mockImplementation(() => new Promise<string[]>(() => {}));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latest = makeProvider();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    jest.restoreAllMocks();
  });

  async function mount(initial: Provider) {
    latest = initial;
    await act(async () => {
      root.render(<Harness initial={initial} onCommit={(provider) => (latest = provider)} />);
    });
  }

  /** Expands the "Advanced" panel and its "Provider Adapters" section. */
  async function openAdapters() {
    const advanced = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Advanced'
    );
    expect(advanced).toBeDefined();
    await act(async () => advanced?.click());

    const section = [...container.querySelectorAll('label')].find(
      (label) => label.textContent?.trim() === 'Provider Adapters'
    );
    expect(section).toBeDefined();
    await act(async () => section?.click());
  }

  function selectFor(label: string): HTMLSelectElement {
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    expect(select).not.toBeNull();
    return select as HTMLSelectElement;
  }

  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  it('renders an Auto / Enabled / Disabled selector for both injected adapters', async () => {
    await mount(makeProvider());
    await openAdapters();

    for (const label of [TOOL_ID_LABEL, DROP_THINKING_LABEL]) {
      const select = selectFor(label);
      expect(select.value).toBe('');
      expect([...select.options].map((option) => option.textContent)).toEqual([
        'Auto (currently: disabled)',
        'Enabled',
        'Disabled',
      ]);
    }
  });

  it('lets an operator disable drop_unsigned_thinking without touching the tool-id entry', async () => {
    await mount(
      makeProvider([{ name: 'normalize_anthropic_tool_ids', options: {}, enabled: false }])
    );
    await openAdapters();

    await choose(selectFor(DROP_THINKING_LABEL), 'off');

    expect(latest.adapter).toEqual([
      { name: 'normalize_anthropic_tool_ids', options: {}, enabled: false },
      { name: 'drop_unsigned_thinking', options: {}, enabled: false },
    ]);
  });

  it('lets an operator force drop_unsigned_thinking on for an Anthropic-compatible gateway', async () => {
    await mount(makeProvider([{ name: 'drop_unsigned_thinking', options: {}, enabled: false }]));
    await openAdapters();

    const select = selectFor(DROP_THINKING_LABEL);
    expect(select.value).toBe('off');

    await choose(select, 'on');

    expect(latest.adapter).toEqual([
      { name: 'drop_unsigned_thinking', options: {}, enabled: true },
    ]);
  });

  it('returns drop_unsigned_thinking to Auto by dropping its entry', async () => {
    await mount(
      makeProvider([
        { name: 'drop_unsigned_thinking', options: {}, enabled: true },
        { name: 'reasoning_content' },
      ])
    );
    await openAdapters();

    expect(selectFor(DROP_THINKING_LABEL).value).toBe('on');

    await choose(selectFor(DROP_THINKING_LABEL), '');

    expect(latest.adapter).toEqual([{ name: 'reasoning_content' }]);
  });
});
