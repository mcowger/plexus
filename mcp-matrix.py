#!/usr/bin/env python3
import json
import subprocess
import sys
from typing import Any

SERVER = 'http://localhost:15152/mcp/plexus'
SESSION = '@plexus-dev'
HEADER = 'x-admin-key: password'


def run_cmd(args: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(args, capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def run_json(args: list[str]) -> tuple[int, Any, str]:
    rc, stdout, stderr = run_cmd(args)
    if not stdout:
        return rc, None, stderr
    try:
        return rc, json.loads(stdout), stderr
    except json.JSONDecodeError:
        return rc, {'_raw': stdout}, stderr


def connect() -> tuple[int, Any, str]:
    return run_json([
        'bunx',
        '@apify/mcpc',
        'connect',
        SERVER,
        SESSION,
        '--no-profile',
        '-H',
        HEADER,
        '--json',
    ])


def session_cmd(*parts: str) -> tuple[int, Any, str]:
    return run_json(['bunx', '@apify/mcpc', SESSION, *parts, '--json'])


def tool_call(tool: str, payload: dict[str, Any]) -> tuple[int, Any, str]:
    return session_cmd('tools-call', tool, json.dumps(payload, separators=(',', ':')))


def parse_tool_result(data: Any) -> tuple[bool, str]:
    if isinstance(data, list):
        return True, f'list[{len(data)}]'

    if not isinstance(data, dict):
        return False, 'non-json response'

    if 'success' in data and 'durationMs' in data:
        return True, f"ping: success={data.get('success')} durationMs={data.get('durationMs')}"
    if 'messages' in data:
        return True, 'prompt ok'
    if 'contents' in data:
        return True, 'resource ok'

    if 'result' in data:
        result = data['result']
        if isinstance(result, dict):
            if 'tools' in result:
                names = [tool.get('name') for tool in result.get('tools', []) if isinstance(tool, dict)]
                hidden = 'plexus_system_logs' not in names
                return True, f'tools[{len(names)}], hidden_system_logs={hidden}'
            if 'prompts' in result:
                return True, f'prompts[{len(result.get("prompts", []))}]'
            if 'resources' in result:
                return True, f'resources[{len(result.get("resources", []))}]'
            if 'messages' in result:
                return True, 'prompt ok'
            if 'contents' in result:
                return True, 'resource ok'
        return True, 'jsonrpc ok'

    if data.get('isError'):
        structured = data.get('structuredContent') or {}
        error = structured.get('error') if isinstance(structured, dict) else None
        if isinstance(error, dict):
            if error.get('type') == 'not_found':
                return True, f"expected not_found: {error.get('message')}"
            return False, f"{error.get('type')} {error.get('code')}: {error.get('message')}"
        content = data.get('content')
        if isinstance(content, list) and content:
            first = content[0]
            if isinstance(first, dict) and first.get('text') == 'Log not found':
                return True, 'expected not_found: Log not found'
        return False, 'tool returned error'

    structured = data.get('structuredContent')
    if not isinstance(structured, dict):
        return False, 'missing structuredContent'

    payload = structured.get('data')
    op = structured.get('operation')

    if isinstance(payload, dict):
        if 'total' in payload and 'data' in payload:
            return True, f'{op}: total={payload.get("total")}'
        if 'range' in payload and 'stats' in payload:
            stats = payload.get('stats') or {}
            return True, f'{op}: range={payload.get("range")} requests={stats.get("totalRequests")}'
        if 'enabledGlobal' in payload:
            return True, f'{op}: enabledGlobal={payload.get("enabledGlobal")}'
        if 'providerCount' in payload:
            return True, f'{op}: providerCount={payload.get("providerCount")}'
        if 'success' in payload:
            return True, f'{op}: success={payload.get("success")}'
        if 'full' in payload:
            return True, f'{op}: full={payload.get("full")}'
        if 'backup' in payload:
            return True, f'{op}: backup envelope'
        return True, f'{op}: object'

    if isinstance(payload, list):
        return True, f'{op}: list[{len(payload)}]'

    return True, f'{op}: ok'


def extract_structured(data: Any) -> dict[str, Any] | None:
    if isinstance(data, dict):
        structured = data.get('structuredContent')
        if isinstance(structured, dict):
            return structured
    return None


results: list[dict[str, Any]] = []


def record(name: str, rc: int, data: Any, stderr: str) -> None:
    passed, summary = parse_tool_result(data)
    results.append(
        {
            'name': name,
            'passed': rc == 0 and passed,
            'summary': summary,
            'stderr': stderr,
            'data': data,
        }
    )


rc, data, stderr = connect()
record('connect', rc, data, stderr)

protocol_checks = [
    ('ping', ('ping',)),
    ('tools-list', ('tools-list',)),
    ('prompts-list', ('prompts-list',)),
    ('prompts-get plexus_management_guide', ('prompts-get', 'plexus_management_guide')),
    ('resources-list', ('resources-list',)),
    ('resources-read plexus://management/guide', ('resources-read', 'plexus://management/guide')),
]

for name, cmd in protocol_checks:
    rc, data, stderr = session_cmd(*cmd)
    record(name, rc, data, stderr)

inventory: dict[str, Any] = {}
backup_envelope: dict[str, Any] | None = None
usage_id: str | None = None
debug_id: str | None = None
cooldown_entry: dict[str, Any] | None = None

static_checks: list[tuple[str, str, dict[str, Any]]] = [
    ('plexus_config status', 'plexus_config', {'operation': 'status'}),
    ('plexus_config get', 'plexus_config', {'operation': 'get'}),
    ('plexus_config export', 'plexus_config', {'operation': 'export'}),
    ('plexus_provider list', 'plexus_provider', {'operation': 'list'}),
    ('plexus_model_alias list', 'plexus_model_alias', {'operation': 'list'}),
    ('plexus_key list', 'plexus_key', {'operation': 'list'}),
    ('plexus_quota list', 'plexus_quota', {'operation': 'list'}),
    ('plexus_quota_checker types', 'plexus_quota_checker', {'operation': 'types'}),
    ('plexus_quota_checker list', 'plexus_quota_checker', {'operation': 'list'}),
    ('plexus_mcp_gateway servers_list', 'plexus_mcp_gateway', {'operation': 'servers_list'}),
    ('plexus_settings get', 'plexus_settings', {'operation': 'get'}),
    ('plexus_settings get failover', 'plexus_settings', {'operation': 'get', 'category': 'failover'}),
    ('plexus_usage list', 'plexus_usage', {'operation': 'list', 'query': {'limit': 1, 'sortDir': 'desc'}}),
    ('plexus_usage summary', 'plexus_usage', {'operation': 'summary', 'query': {'range': 'day'}}),
    ('plexus_debug state', 'plexus_debug', {'operation': 'state'}),
    ('plexus_debug update enable', 'plexus_debug', {'operation': 'update', 'body': {'enabled': True, 'providers': ['openrouter']}}),
    ('plexus_debug logs', 'plexus_debug', {'operation': 'logs', 'query': {'limit': 1}}),
    ('plexus_operations backup', 'plexus_operations', {'operation': 'backup'}),
    ('plexus_operations list_cooldowns', 'plexus_operations', {'operation': 'list_cooldowns'}),
    ('plexus_operations restart', 'plexus_operations', {'operation': 'restart', 'destructive': 'acknowledged'}),
]

for name, tool, payload in static_checks:
    rc, data, stderr = tool_call(tool, payload)
    record(name, rc, data, stderr)

    structured = extract_structured(data) or {}
    tool_data = structured.get('data')

    if name == 'plexus_provider list' and isinstance(tool_data, list) and tool_data:
        inventory['plexus_provider'] = tool_data[0].get('id')
    elif name == 'plexus_model_alias list' and isinstance(tool_data, list) and tool_data:
        inventory['plexus_model_alias'] = tool_data[0].get('id')
    elif name == 'plexus_key list' and isinstance(tool_data, list) and tool_data:
        inventory['plexus_key'] = tool_data[0].get('id')
    elif name == 'plexus_quota list' and isinstance(tool_data, list) and tool_data:
        inventory['plexus_quota'] = tool_data[0].get('id')
    elif name == 'plexus_quota_checker list' and isinstance(tool_data, list) and tool_data:
        inventory['plexus_quota_checker'] = tool_data[0].get('id')
    elif name == 'plexus_mcp_gateway servers_list' and isinstance(tool_data, list) and tool_data:
        inventory['plexus_mcp_gateway'] = tool_data[0].get('id')
    elif name == 'plexus_usage list' and isinstance(tool_data, dict):
        rows = tool_data.get('data') or []
        if rows and isinstance(rows, list):
            usage_id = rows[0].get('requestId')
    elif name == 'plexus_debug logs' and isinstance(tool_data, list) and tool_data:
        debug_id = tool_data[0].get('requestId')
    elif name == 'plexus_operations backup' and isinstance(tool_data, dict):
        backup_envelope = tool_data.get('backup')
    elif name == 'plexus_operations list_cooldowns' and isinstance(tool_data, list) and tool_data:
        cooldown_entry = tool_data[0]

followup_checks: list[tuple[str, str, dict[str, Any]]] = []

for tool_name in ['plexus_provider', 'plexus_model_alias', 'plexus_key', 'plexus_quota', 'plexus_quota_checker', 'plexus_mcp_gateway']:
    item_id = inventory.get(tool_name)
    if item_id:
        followup_checks.append((f'{tool_name} get {item_id}', tool_name, {'operation': 'get', 'id': item_id}))

if debug_id:
    followup_checks.append((f'plexus_debug get_log {debug_id}', 'plexus_debug', {'operation': 'get_log', 'id': debug_id}))
    followup_checks.append((f'plexus_debug delete_log {debug_id}', 'plexus_debug', {'operation': 'delete_log', 'id': debug_id, 'destructive': 'acknowledged'}))
else:
    followup_checks.append(('plexus_debug get_log nonexistent-debug-id', 'plexus_debug', {'operation': 'get_log', 'id': 'nonexistent-debug-id'}))

if usage_id:
    followup_checks.append((f'plexus_usage delete {usage_id}', 'plexus_usage', {'operation': 'delete', 'id': usage_id, 'destructive': 'acknowledged'}))

followup_checks.extend(
    [
        ('plexus_debug delete_all_logs', 'plexus_debug', {'operation': 'delete_all_logs', 'destructive': 'acknowledged'}),
        ('plexus_usage delete_all old-only', 'plexus_usage', {'operation': 'delete_all', 'query': {'olderThanDays': 100000}, 'destructive': 'acknowledged'}),
    ]
)

if cooldown_entry:
    query = {'provider': cooldown_entry.get('provider')}
    if cooldown_entry.get('model'):
        query['model'] = cooldown_entry.get('model')
    followup_checks.append(
        (
            f"plexus_operations clear_cooldowns {query.get('provider')}:{query.get('model', '')}",
            'plexus_operations',
            {'operation': 'clear_cooldowns', 'query': query, 'destructive': 'acknowledged'},
        )
    )

if backup_envelope:
    followup_checks.append(
        (
            'plexus_operations restore config backup',
            'plexus_operations',
            {'operation': 'restore', 'body': backup_envelope, 'destructive': 'acknowledged'},
        )
    )

followup_checks.extend(
    [
        ('plexus_operations reset_logs', 'plexus_operations', {'operation': 'reset_logs'}),
        ('plexus_debug update disable', 'plexus_debug', {'operation': 'update', 'body': {'enabled': False, 'providers': None}}),
        ('plexus_debug state final', 'plexus_debug', {'operation': 'state'}),
    ]
)

for name, tool, payload in followup_checks:
    rc, data, stderr = tool_call(tool, payload)
    record(name, rc, data, stderr)

failures = [r for r in results if not r['passed']]

for result in results:
    status = 'PASS' if result['passed'] else 'FAIL'
    print(f"{status:4} | {result['name']} | {result['summary']}")
    if result['stderr']:
        print(f"      stderr: {result['stderr'][:300]}")

print(f"\nTOTAL {len(results)} checks, {len(failures)} failures")

if failures:
    sys.exit(1)
