import { plexusCliSkill } from './skill';

export const DEFAULT_URL = 'http://localhost:4000';
const OPENAPI_PATH = '/.well-known/plexus/openapi.json';
const ALLOWED_PATH = /^\/v0\/(management\/|system\/logs\/)/;
const HTTP_METHODS = new Set(['delete', 'get', 'head', 'patch', 'post', 'put']);
const RISKY_OPERATION = /delete|restore|restart|reset|clear|rotate|disable/i;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { required?: boolean; content?: Record<string, unknown> };
  responses?: Record<string, { content?: Record<string, unknown> }>;
}

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  operation: OpenApiOperation;
}

export interface ParsedArgs {
  positionals: string[];
  url: string;
  adminKey?: string;
  output?: 'json' | 'yaml' | 'table';
  yes: boolean;
  all: boolean;
  params: Map<string, Json>;
  body?: string;
  bodyFile?: string;
  help: boolean;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2
  ) {
    super(message);
  }
}

export function parseJsonLiteral(value: string): Json {
  try {
    return JSON.parse(value) as Json;
  } catch {
    return value;
  }
}

export function parseArgs(argv: string[], env: Record<string, string | undefined>): ParsedArgs {
  const result: ParsedArgs = {
    positionals: [],
    url: env.PLEXUS_URL || DEFAULT_URL,
    adminKey: env.PLEXUS_ADMIN_KEY,
    yes: false,
    all: false,
    params: new Map(),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    const value = (): string => {
      const next = argv[++index];
      if (next === undefined || next.startsWith('--'))
        throw new CliError(`${arg} requires a value`);
      return next;
    };
    if (arg === '--url') result.url = value();
    else if (arg === '--admin-key') result.adminKey = value();
    else if (arg === '--output') {
      const output = value();
      if (output !== 'json' && output !== 'yaml' && output !== 'table') {
        throw new CliError('--output must be json, yaml, or table');
      }
      result.output = output;
    } else if (arg === '--param') {
      const parameter = value();
      const separator = parameter.indexOf('=');
      if (separator < 1) throw new CliError('--param must use name=value');
      result.params.set(
        parameter.slice(0, separator),
        parseJsonLiteral(parameter.slice(separator + 1))
      );
    } else if (arg === '--body') result.body = value();
    else if (arg === '--body-file') result.bodyFile = value();
    else if (arg === '--yes') result.yes = true;
    else if (arg === '--all') result.all = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg.startsWith('--')) throw new CliError(`Unknown option: ${arg}`);
    else result.positionals.push(arg);
  }
  if (result.body && result.bodyFile)
    throw new CliError('Use either --body or --body-file, not both');
  return result;
}

export function discoverOperations(document: {
  paths?: Record<string, Record<string, unknown>>;
}): Operation[] {
  const candidates: Operation[] = [];
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!ALLOWED_PATH.test(path)) continue;
    const pathParameters = Array.isArray(pathItem.parameters)
      ? (pathItem.parameters as OpenApiParameter[])
      : [];
    for (const [method, value] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !value || typeof value !== 'object') continue;
      const operation = value as OpenApiOperation;
      if (isStreamOperation(operation)) continue;
      const parameters = new Map(
        pathParameters.map((parameter) => [`${parameter.in}:${parameter.name}`, parameter])
      );
      for (const parameter of operation.parameters ?? []) {
        parameters.set(`${parameter.in}:${parameter.name}`, parameter);
      }
      candidates.push({
        id: operation.operationId ?? fallbackId(method, path, operation.tags),
        method,
        path,
        operation: { ...operation, parameters: [...parameters.values()] },
      });
    }
  }
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
  return candidates
    .map((candidate) =>
      counts.get(candidate.id) === 1
        ? candidate
        : {
            ...candidate,
            id: fallbackId(candidate.method, candidate.path, candidate.operation.tags),
          }
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function fallbackId(method: string, path: string, tags?: string[]): string {
  const tag = tags?.[0]?.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  const route = path
    .replace(/^\/v0\//, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '');
  return [tag, method, route].filter(Boolean).join('-').toLowerCase();
}

export function isStreamOperation(operation: OpenApiOperation): boolean {
  return Object.values(operation.responses ?? {}).some((response) =>
    Object.keys(response.content ?? {}).some(
      (contentType) => contentType.toLowerCase() === 'text/event-stream'
    )
  );
}

export function isRisky(operation: Operation): boolean {
  return operation.method === 'delete' || RISKY_OPERATION.test(`${operation.id} ${operation.path}`);
}

export function buildRequest(
  operation: Operation,
  params: Map<string, Json>
): { url: string; headers: Headers } {
  let path = operation.path;
  const query = new URLSearchParams();
  const headers = new Headers();
  const parameters = operation.operation.parameters ?? [];
  for (const parameter of parameters) {
    const value = params.get(parameter.name);
    if (value === undefined) {
      if (parameter.required)
        throw new CliError(`Missing required --param ${parameter.name}=value`);
      continue;
    }
    const encoded = typeof value === 'string' ? value : JSON.stringify(value);
    if (parameter.in === 'path')
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(encoded));
    if (parameter.in === 'query') query.set(parameter.name, encoded);
    if (parameter.in === 'header') headers.set(parameter.name, encoded);
  }
  for (const name of params.keys()) {
    if (!parameters.some((parameter) => parameter.name === name))
      throw new CliError(`Unknown parameter: ${name}`);
  }
  return { url: `${path}${query.size ? `?${query}` : ''}`, headers };
}

function yaml(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    return value.length === 0
      ? '[]'
      : value.map((item) => `${indent}- ${yaml(item, `${indent}  `)}`).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return entries.length === 0
      ? '{}'
      : entries
          .map(([key, item]) =>
            item && typeof item === 'object'
              ? `${indent}${key}:\n${yaml(item, `${indent}  `)}`
              : `${indent}${key}: ${yaml(item, `${indent}  `)}`
          )
          .join('\n');
  }
  return JSON.stringify(value) ?? 'null';
}

function table(value: unknown): string {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row)))
    return JSON.stringify(value, null, 2);
  const records = rows as Array<Record<string, unknown>>;
  const columns = [...new Set(records.flatMap((row) => Object.keys(row)))].sort();
  const cells = records.map((row) => columns.map((column) => formatCell(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => (row[index] ?? '').length))
  );
  const line = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(columns), line(widths.map((width) => '-'.repeat(width))), ...cells.map(line)].join(
    '\n'
  );
}

function formatCell(value: unknown): string {
  if (value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function getPaginatedData(value: Json): { data: Json[]; total: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { data, total } = value;
  if (!Array.isArray(data) || typeof total !== 'number') return undefined;
  return { data, total };
}

async function fetchAllPages(
  baseUrl: string,
  operation: Operation,
  params: Map<string, Json>,
  headers: Headers,
  fetcher: Runtime['fetch']
): Promise<Json> {
  const parameterNames = new Set(
    (operation.operation.parameters ?? []).map((parameter) => parameter.name)
  );
  if (!parameterNames.has('limit') || !parameterNames.has('offset')) {
    throw new CliError('--all requires documented limit and offset parameters');
  }
  const allData: Json[] = [];
  let offset = typeof params.get('offset') === 'number' ? (params.get('offset') as number) : 0;
  let total: number | undefined;
  let limit = typeof params.get('limit') === 'number' ? (params.get('limit') as number) : undefined;

  while (total === undefined || allData.length < total) {
    const pageParams = new Map(params);
    pageParams.set('offset', offset);
    const request = buildRequest(operation, pageParams);
    const response = await fetcher(`${baseUrl}${request.url}`, {
      method: operation.method.toUpperCase(),
      headers,
    });
    const text = await response.text();
    if (!response.ok) throw new CliError(`HTTP ${response.status}: ${text}`, 1);
    const page = getPaginatedData(JSON.parse(text) as Json);
    if (!page) throw new CliError('--all requires a paginated { data, total } response');
    total = page.total;
    limit ??= page.data.length;
    if (!limit || page.data.length === 0) break;
    allData.push(...page.data);
    offset += page.data.length;
  }

  return { data: allData, total: total ?? allData.length, limit: limit ?? 0, offset: 0 };
}

export function formatOutput(value: unknown, output: 'json' | 'yaml' | 'table'): string {
  if (output === 'yaml') return `${yaml(value)}\n`;
  if (output === 'table') return `${table(value)}\n`;
  return `${JSON.stringify(value, null, 2)}\n`;
}

const HELP = `Usage: plexuscli [options] <skill|api> [operation]

AGENTS: Run \`plexuscli skill\` to print the \`plexus-cli\` skill and understand how to use this tool.

Commands:
  skill                  Print the bundled plexus-cli SKILL.md
  api list               List discovered management operations
  api describe OPERATION Describe a discovered operation
  api call OPERATION     Call a discovered operation

Options:
  --url URL              Plexus URL (default: PLEXUS_URL or ${DEFAULT_URL})
  --admin-key KEY        Admin key (default: PLEXUS_ADMIN_KEY)
  --param name=value     Parameter; JSON literals are coerced
  --body JSON            JSON request body, or - to read stdin
  --body-file FILE       JSON request body file
  --all                  Retrieve every page from a paginated list operation
  --output json|yaml|table
  --yes                  Skip risky-operation confirmation

Exit status: 0 success or help; 1 network or HTTP failure; 2 invalid input, refused action, or unsupported stream operation.
`;

export interface Runtime {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  stdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
  confirm: (message: string) => Promise<boolean>;
}

export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  runtime: Runtime
): Promise<number> {
  try {
    const args = parseArgs(argv, env);
    if (args.help || args.positionals.length === 0) {
      runtime.stdout(HELP);
      return 0;
    }
    if (args.positionals.length === 1 && args.positionals[0] === 'skill') {
      runtime.stdout(plexusCliSkill);
      return 0;
    }
    const baseUrl = args.url.replace(/\/$/, '');
    const specResponse = await runtime.fetch(`${baseUrl}${OPENAPI_PATH}`, { cache: 'no-store' });
    if (!specResponse.ok)
      throw new CliError(`OpenAPI fetch failed: HTTP ${specResponse.status}`, 1);
    const operations = discoverOperations(
      (await specResponse.json()) as { paths?: Record<string, Record<string, unknown>> }
    );
    const [group, action, identifier] = args.positionals;
    const output = args.output ?? (runtime.isTTY ? 'table' : 'json');
    if (group === 'api' && action === 'list' && !identifier) {
      runtime.stdout(
        formatOutput(
          operations.map(({ id, method, path, operation }) => ({
            id,
            method: method.toUpperCase(),
            path,
            tags: operation.tags ?? [],
            summary: operation.summary ?? '',
          })),
          output
        )
      );
      return 0;
    }
    const operation =
      group === 'api'
        ? operations.find((candidate) => candidate.id === identifier)
        : operations.find((candidate) => candidate.id === group);
    if (!operation) throw new CliError(`Unknown or unsupported operation: ${identifier ?? group}`);
    if (group === 'api' && action === 'describe') {
      runtime.stdout(
        formatOutput(
          {
            id: operation.id,
            method: operation.method.toUpperCase(),
            path: operation.path,
            description: operation.operation.description ?? operation.operation.summary ?? '',
            parameters: operation.operation.parameters ?? [],
            requiresBody: Boolean(operation.operation.requestBody?.required),
          },
          output
        )
      );
      return 0;
    }
    if (group === 'api' && action !== 'call')
      throw new CliError('Use: api list, api describe <operation>, or api call <operation>');
    if (
      isRisky(operation) &&
      !args.yes &&
      !(await runtime.confirm(`Run risky ${operation.method.toUpperCase()} ${operation.path}?`))
    ) {
      throw new CliError('Operation cancelled');
    }
    let body = args.body;
    if (args.bodyFile) body = await Bun.file(args.bodyFile).text();
    if (body === '-') body = await runtime.stdin();
    if (!body && !runtime.isTTY) body = (await runtime.stdin()).trim() || undefined;
    if (operation.operation.requestBody?.required && !body) {
      throw new CliError('This operation requires --body, --body-file, or JSON on stdin');
    }
    if (body) JSON.parse(body);
    const request = buildRequest(operation, args.params);
    if (args.adminKey) request.headers.set('x-admin-key', args.adminKey);
    if (body) request.headers.set('content-type', 'application/json');
    if (args.all) {
      if (operation.method !== 'get')
        throw new CliError('--all can only be used with GET operations');
      if (body) throw new CliError('--all cannot be used with a request body');
      runtime.stdout(
        formatOutput(
          await fetchAllPages(baseUrl, operation, args.params, request.headers, runtime.fetch),
          output
        )
      );
      return 0;
    }
    const response = await runtime.fetch(`${baseUrl}${request.url}`, {
      method: operation.method.toUpperCase(),
      headers: request.headers,
      body,
    });
    const responseText = await response.text();
    if (!response.ok) {
      runtime.stderr(`HTTP ${response.status}: ${responseText}\n`);
      return 1;
    }
    if (!responseText) return 0;
    try {
      runtime.stdout(formatOutput(JSON.parse(responseText) as Json, output));
    } catch {
      runtime.stdout(`${responseText}\n`);
    }
    return 0;
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError(error instanceof Error ? error.message : String(error), 1);
    runtime.stderr(`${cliError.message}\n`);
    return cliError.exitCode;
  }
}
