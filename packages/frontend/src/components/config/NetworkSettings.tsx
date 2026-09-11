import { Network, Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Disclosure } from '../ui/Disclosure';
import { TagSelect } from '../ui/TagSelect';

interface NetworkSettingsProps {
  trustedProxies: string[];
  loaded: boolean;
  saving: boolean;
  onChange: (trustedProxies: string[]) => void;
  onSave: () => void;
}

export function NetworkSettings({
  trustedProxies,
  loaded,
  saving,
  onChange,
  onSave,
}: NetworkSettingsProps) {
  return (
    <Disclosure
      title="Network Settings"
      defaultOpen={false}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          isLoading={saving}
          disabled={!loaded}
          leftIcon={<Save size={14} />}
        >
          Save
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Network size={16} className="text-primary" />
          <div>
            <p className="font-body text-[12px] font-medium text-text">Trusted Proxies</p>
            <p className="font-body text-[11px] text-text-muted">
              IPs/CIDRs of reverse proxies whose forwarding headers (X-Forwarded-For,
              CF-Connecting-IP, …) are believed when resolving a client&apos;s IP. Requests arriving
              directly from any other address use their real connection IP instead, so spoofed
              headers cannot defeat per-key IP allowlists.
            </p>
          </div>
        </div>

        <div>
          <TagSelect
            label="Trusted Proxy IPs"
            placeholder="e.g. 10.0.0.0/8  172.16.0.0/12  192.168.1.5"
            options={[]}
            selected={trustedProxies}
            allowCustom
            splitOnSpace
            onChange={onChange}
          />
          <p className="text-xs text-text-muted mt-2">
            Type entries separated by spaces. The default trust-all list is <code>0.0.0.0/0</code>{' '}
            plus <code>::/0</code> — keep this only if Plexus is not publicly reachable except
            through your proxy. An empty list trusts no proxies. Accepts IPv4/IPv6, CIDR, and
            ranges.
          </p>
        </div>
      </div>
    </Disclosure>
  );
}
