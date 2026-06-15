#!/usr/bin/env bun
/**
 * OpenAPI Sync Script
 *
 * Analyzes Fastify route definitions and generates/updates OpenAPI path files.
 * Helps maintain synchronization between API routes and OpenAPI documentation.
 *
 * Usage:
 *   bun run scripts/sync-openapi.ts          # Check for missing endpoints
 *   bun run scripts/sync-openapi.ts --write  # Generate missing OpenAPI files
 *   bun run scripts/sync-openapi.ts --diff   # Show detailed diff
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, relative, basename } from 'path';
import { parse } from 'yaml';

// ─── Configuration ───────────────────────────────────────────────────

const ROUTES_DIR = join(__dirname, '../packages/backend/src/routes');
const BACKEND_INDEX = join(__dirname, '../packages/backend/src/index.ts');
const OPENAPI_DIR = join(__dirname, '../docs/openapi');
const OPENAPI_PATHS_DIR = join(OPENAPI_DIR, 'paths');
const OPENAPI_MAIN_FILE = join(OPENAPI_DIR, 'openapi.yaml');

// Route patterns to ignore (not user-facing APIs)
const IGNORED_ROUTE_PATTERNS = [/__tests__/, /\.test\./, /\.spec\./];

// HTTP methods we care about
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Normalize a route path for comparison.
 * Converts :param to {param} and * to {wildcard}
 */
function normalizePath(path: string): string {
  return (
    path
      // Convert :paramName to {paramName}
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')
      // Convert * wildcard to {wildcard}
      .replace(/\*/g, '{wildcard}')
      // Normalize multiple slashes
      .replace(/\/+/g, '/')
  );
}

// ─── Types ───────────────────────────────────────────────────────────

interface RouteInfo {
  path: string;
  method: HttpMethod;
  file: string;
  line: number;
  handler: string;
}

interface OpenApiPathInfo {
  path: string;
  methods: HttpMethod[];
  file: string;
}

interface SyncReport {
  routesFound: RouteInfo[];
  openApiPaths: OpenApiPathInfo[];
  missingFromOpenApi: RouteInfo[];
  missingFromRoutes: OpenApiPathInfo[];
  mismatchedMethods: Array<{
    path: string;
    routeMethods: HttpMethod[];
    openApiMethods: HttpMethod[];
  }>;
}

// ─── Route Parser ────────────────────────────────────────────────────

/**
 * Parse a TypeScript file to extract Fastify route registrations.
 * Uses regex-based parsing (simpler than AST for this use case).
 */
async function parseRoutesFromFile(filePath: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Match patterns like:
    // - fastify.get('/path', handler)
    // - mgmt.get('/path', handler)
    // - app.post('/path', handler)
    // Supports any identifier followed by HTTP method
    // - fastify.get(\n    '/path',\n    handler
    const routeRegex =
      /[a-zA-Z_][a-zA-Z0-9_]*\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(routeRegex);

      if (match) {
        const method = match[1] as HttpMethod;
        const path = match[2];

        // Skip internal/test routes
        if (path.startsWith('/__') || path.includes('__')) {
          continue;
        }

        routes.push({
          path,
          method,
          file: filePath,
          line: i + 1,
          handler: line.trim().substring(0, 100),
        });
      }
    }

    // Also check for multi-line route definitions
    // Pattern: fastify.get(\n    '/path',
    // Supports any identifier (fastify, mgmt, app, etc.)
    const multiLineRegex =
      /[a-zA-Z_][a-zA-Z0-9_]*\.(get|post|put|patch|delete|options|head)\s*\(\s*\n\s*['"`]([^'"`]+)['"`]/g;
    let multiMatch;
    while ((multiMatch = multiLineRegex.exec(content)) !== null) {
      const method = multiMatch[1] as HttpMethod;
      const path = multiMatch[2];

      if (path.startsWith('/__') || path.includes('__')) {
        continue;
      }

      // Find the line number
      const beforeMatch = content.substring(0, multiMatch.index);
      const lineNumber = beforeMatch.split('\n').length;

      routes.push({
        path,
        method,
        file: filePath,
        line: lineNumber,
        handler: `Multi-line ${method.toUpperCase()} ${path}`,
      });
    }
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
  }

  return routes;
}

/**
 * Recursively scan a directory for TypeScript files and extract all routes.
 */
async function scanRoutesDirectory(dirPath: string): Promise<RouteInfo[]> {
  const allRoutes: RouteInfo[] = [];

  async function scanDir(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      // Skip ignored patterns
      if (IGNORED_ROUTE_PATTERNS.some((pattern) => pattern.test(fullPath))) {
        continue;
      }

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const routes = await parseRoutesFromFile(fullPath);
        allRoutes.push(...routes);
      }
    }
  }

  await scanDir(dirPath);

  // Also scan the backend index.ts for routes like /health
  try {
    const indexRoutes = await parseRoutesFromFile(BACKEND_INDEX);
    allRoutes.push(...indexRoutes);
  } catch (error) {
    // Ignore if index.ts doesn't exist
  }

  return allRoutes;
}

// ─── OpenAPI Parser ──────────────────────────────────────────────────

/**
 * Parse the main OpenAPI file to extract path references.
 */
async function parseOpenApiMainFile(): Promise<OpenApiPathInfo[]> {
  const content = await readFile(OPENAPI_MAIN_FILE, 'utf-8');
  const openApi = parse(content) as any;

  const paths: OpenApiPathInfo[] = [];

  if (!openApi.paths) {
    return paths;
  }

  for (const [path, pathItem] of Object.entries(openApi.paths)) {
    const methods: HttpMethod[] = [];

    // Check if it's a $ref or inline definition
    if (typeof pathItem === 'object' && pathItem !== null) {
      // Check for $ref property (YAML parsed as object)
      if (pathItem.$ref && typeof pathItem.$ref === 'string') {
        // Extract file reference from $ref: paths/xxx.yaml
        const refMatch = pathItem.$ref.match(/^paths\/(.+\.yaml)$/);
        if (refMatch) {
          const refFile = refMatch[1];
          const methodsInFile = await parseOpenApiPathFile(join(OPENAPI_PATHS_DIR, refFile));
          methods.push(...methodsInFile);
        }
      } else {
        // Inline definition
        for (const method of HTTP_METHODS) {
          if ((pathItem as any)[method]) {
            methods.push(method);
          }
        }
      }
    }

    if (methods.length > 0) {
      paths.push({
        path,
        methods: [...new Set(methods)] as HttpMethod[],
        file: OPENAPI_MAIN_FILE,
      });
    }
  }

  return paths;
}

/**
 * Parse an individual OpenAPI path file to extract HTTP methods.
 */
async function parseOpenApiPathFile(filePath: string): Promise<HttpMethod[]> {
  const methods: HttpMethod[] = [];

  try {
    const content = await readFile(filePath, 'utf-8');
    const pathItem = parse(content) as any;

    for (const method of HTTP_METHODS) {
      if (pathItem[method]) {
        methods.push(method);
      }
    }
  } catch (error) {
    console.error(`Error parsing OpenAPI file ${filePath}:`, error);
  }

  return methods;
}

// ─── OpenAPI Generator ───────────────────────────────────────────────

/**
 * Generate a basic OpenAPI path file for a route.
 */
function generateOpenApiPathFile(route: RouteInfo, tag: string): string {
  const normalizedPath = normalizePath(route.path);
  const operationId = `${route.method}V0${normalizedPath
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')}`;

  const methodUpper = route.method.toUpperCase();

  return `${route.method}:
  tags:
    - ${tag}
  summary: TODO - Add summary for ${methodUpper} ${normalizedPath}
  description: |
    TODO - Add detailed description.
    
    **Admin only** — limited principals receive 403.
  security:
    - AdminKey: []
  responses:
    '200':
      description: Successful response.
    '401':
      description: Authentication required or invalid credentials.
    '404':
      description: Resource not found.
  operationId: ${operationId}
`;
}

/**
 * Generate the path reference entry for openapi.yaml
 */
function generatePathReference(route: RouteInfo): string {
  // Convert route path to filename
  const filename =
    route.path
      .replace(/^\//, '')
      .replace(/\//g, '_')
      .replace(/:/g, '_')
      .replace(/{/g, '')
      .replace(/}/g, '') + '.yaml';

  return `  ${route.path}:
    $ref: paths/${filename}`;
}

// ─── Sync Logic ──────────────────────────────────────────────────────

/**
 * Compare routes with OpenAPI definitions and generate a report.
 */
async function generateSyncReport(): Promise<SyncReport> {
  console.log('🔍 Scanning Fastify routes...');
  const routes = await scanRoutesDirectory(ROUTES_DIR);

  console.log('📄 Parsing OpenAPI definitions...');
  const openApiPaths = await parseOpenApiMainFile();

  // Group routes by normalized path
  const routesByPath = new Map<string, RouteInfo[]>();
  for (const route of routes) {
    const normalizedPath = normalizePath(route.path);
    const existing = routesByPath.get(normalizedPath) || [];
    existing.push(route);
    routesByPath.set(normalizedPath, existing);
  }

  // Group OpenAPI paths (already in OpenAPI format)
  const openApiByPath = new Map<string, OpenApiPathInfo>();
  for (const pathInfo of openApiPaths) {
    openApiByPath.set(pathInfo.path, pathInfo);
  }

  // Find missing from OpenAPI
  const missingFromOpenApi: RouteInfo[] = [];
  const mismatchedMethods: SyncReport['mismatchedMethods'] = [];

  // Paths to exclude from OpenAPI documentation (UI routes, health checks, etc.)
  const excludedPaths = [/^\/ui\//, /^\/ui$/, /^\/$/, /^\/health$/];

  for (const [normalizedPath, routeList] of routesByPath) {
    // Skip excluded paths
    if (excludedPaths.some((pattern) => pattern.test(normalizedPath))) {
      continue;
    }

    const openApiInfo = openApiByPath.get(normalizedPath);

    if (!openApiInfo) {
      // Check if this is a wildcard route that exists in OpenAPI with named parameters
      // e.g., code has /providers/{wildcard} but OpenAPI has /providers/{slug}
      if (normalizedPath.includes('{wildcard}')) {
        // Look for similar paths in OpenAPI
        const basePattern = normalizedPath.replace(/{wildcard}/g, '');
        const hasSimilarPath = Array.from(openApiByPath.keys()).some(
          (key) => key.includes(basePattern) && key.match(/{[a-zA-Z_][a-zA-Z0-9_]*}/)
        );
        if (hasSimilarPath) {
          // Skip - this wildcard route is documented with named parameters
          continue;
        }
      }
      missingFromOpenApi.push(...routeList);
    } else {
      // Check for method mismatches
      const routeMethods = [...new Set(routeList.map((r) => r.method))] as HttpMethod[];
      const missingMethods = routeMethods.filter((m) => !openApiInfo.methods.includes(m));

      if (missingMethods.length > 0) {
        mismatchedMethods.push({
          path: normalizedPath,
          routeMethods,
          openApiMethods: openApiInfo.methods,
        });
      }
    }
  }

  // Find missing from routes (OpenAPI has paths that don't exist in code)
  const missingFromRoutes: OpenApiPathInfo[] = [];
  for (const [path, openApiInfo] of openApiByPath) {
    if (!routesByPath.has(path)) {
      // Skip if this is a wildcard route that exists with different param naming
      // e.g., OpenAPI has {slug} but code uses * (wildcard)
      const hasWildcardVersion = routesByPath.has(
        path.replace(/{[a-zA-Z_][a-zA-Z0-9_]*}/g, '{wildcard}')
      );
      if (hasWildcardVersion) {
        continue;
      }
      missingFromRoutes.push(openApiInfo);
    }
  }

  return {
    routesFound: routes,
    openApiPaths,
    missingFromOpenApi,
    missingFromRoutes,
    mismatchedMethods,
  };
}

/**
 * Print a sync report to the console.
 */
function printSyncReport(report: SyncReport) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 OpenAPI Sync Report');
  console.log('='.repeat(80));

  console.log(`\n✅ Routes found: ${report.routesFound.length}`);
  console.log(`📝 OpenAPI paths: ${report.openApiPaths.length}`);

  if (
    report.missingFromOpenApi.length === 0 &&
    report.missingFromRoutes.length === 0 &&
    report.mismatchedMethods.length === 0
  ) {
    console.log('\n✨ All routes are documented in OpenAPI!');
    return;
  }

  // Missing from OpenAPI
  if (report.missingFromOpenApi.length > 0) {
    console.log(`\n❌ Missing from OpenAPI: ${report.missingFromOpenApi.length} endpoint(s)`);
    const byPath = new Map<string, RouteInfo[]>();
    for (const route of report.missingFromOpenApi) {
      const normalizedPath = normalizePath(route.path);
      const existing = byPath.get(normalizedPath) || [];
      existing.push(route);
      byPath.set(normalizedPath, existing);
    }

    for (const [path, routes] of byPath) {
      const methods = routes.map((r) => r.method.toUpperCase()).join(', ');
      console.log(`   ${methods} ${path}`);
      routes.forEach((r) => {
        console.log(`      └─ ${relative(process.cwd(), r.file)}:${r.line}`);
      });
    }
  }

  // Missing from routes
  if (report.missingFromRoutes.length > 0) {
    console.log(`\n⚠️  In OpenAPI but not in routes: ${report.missingFromRoutes.length} path(s)`);
    for (const pathInfo of report.missingFromRoutes) {
      const methods = pathInfo.methods.map((m) => m.toUpperCase()).join(', ');
      console.log(`   ${methods} ${pathInfo.path}`);
    }
  }

  // Method mismatches
  if (report.mismatchedMethods.length > 0) {
    console.log(`\n⚠️  Method mismatches: ${report.mismatchedMethods.length} path(s)`);
    for (const mismatch of report.mismatchedMethods) {
      console.log(`   ${mismatch.path}`);
      console.log(`      Routes: ${mismatch.routeMethods.map((m) => m.toUpperCase()).join(', ')}`);
      console.log(
        `      OpenAPI: ${mismatch.openApiMethods.map((m) => m.toUpperCase()).join(', ')}`
      );
    }
  }

  console.log('\n' + '='.repeat(80));
}

/**
 * Generate missing OpenAPI files.
 */
async function generateMissingFiles(report: SyncReport, dryRun = false) {
  const generated: string[] = [];
  const processed = new Set<string>(); // Avoid generating duplicate files

  for (const route of report.missingFromOpenApi) {
    const normalizedPath = normalizePath(route.path);
    const fileKey = `${route.method}:${normalizedPath}`;

    // Skip if we've already processed this route
    if (processed.has(fileKey)) {
      continue;
    }
    processed.add(fileKey);
    // Determine tag based on path
    let tag = 'Management';
    if (normalizedPath.includes('/management/')) {
      const subPath = normalizedPath.replace('/v0/management/', '');
      const firstSegment = subPath.split('/')[0];

      switch (firstSegment) {
        case 'config':
          tag = 'Management — Config';
          break;
        case 'providers':
        case 'aliases':
        case 'models':
        case 'keys':
        case 'mcp-servers':
          tag = `Management — ${firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1)}`;
          break;
        case 'quota':
        case 'quotas':
          tag = 'Management — Quotas (Provider)';
          break;
        case 'user-quotas':
          tag = 'Management — Quotas (User)';
          break;
        case 'oauth':
          tag = 'Management — OAuth';
          break;
        case 'usage':
          tag = 'Management — Usage';
          break;
        case 'debug':
          tag = 'Management — Debug';
          break;
        case 'errors':
          tag = 'Management — Errors';
          break;
        case 'mcp-logs':
          tag = 'Management — MCP Logs';
          break;
        case 'cooldowns':
          tag = 'Management — Cooldowns';
          break;
        case 'performance':
          tag = 'Management — Performance';
          break;
        case 'metrics':
          tag = 'Management — Metrics';
          break;
        case 'logging':
          tag = 'Management — Logging';
          break;
        case 'pi':
          tag = 'Management — PI (Plexus Internal)';
          break;
        case 'self':
          tag = 'Management — Self';
          break;
        case 'auth':
          tag = 'Management — Auth';
          break;
        case 'test':
        case 'restart':
        case 'backup':
        case 'restore':
        case 'events':
          tag = 'Management — System';
          break;
        default:
          tag = 'Management';
      }
    } else if (route.path.startsWith('/v1/')) {
      tag = 'Inference';
    } else if (route.path.startsWith('/mcp/')) {
      tag = 'MCP';
    }

    const filename =
      normalizedPath.replace(/^\//, '').replace(/\//g, '_').replace(/{/g, '').replace(/}/g, '') +
      '.yaml';

    const filePath = join(OPENAPI_PATHS_DIR, filename);
    const content = generateOpenApiPathFile(route, tag);

    if (dryRun) {
      console.log(`📝 Would create: ${filename}`);
    } else {
      await writeFile(filePath, content, 'utf-8');
      console.log(`✅ Created: ${filename}`);
    }

    generated.push(filename);
  }

  if (!dryRun && generated.length > 0) {
    console.log(`\n✨ Generated ${generated.length} OpenAPI path file(s)`);
    console.log('📝 Next steps:');
    console.log('   1. Edit the generated files to add proper descriptions and schemas');
    console.log('   2. Run: bun run lint:openapi');
    console.log('   3. Update docs/openapi/openapi.yaml to include the new paths');
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const writeMode = args.includes('--write');
  const diffMode = args.includes('--diff');
  const quietMode = args.includes('--quiet') || args.includes('-q');

  if (!quietMode) {
    console.log('🔄 OpenAPI Sync Tool');
    console.log('   Routes: ' + relative(process.cwd(), ROUTES_DIR));
    console.log('   OpenAPI: ' + relative(process.cwd(), OPENAPI_DIR));
    console.log('');
  }

  const report = await generateSyncReport();

  if (diffMode || !quietMode) {
    printSyncReport(report);
  }

  if (writeMode && report.missingFromOpenApi.length > 0) {
    console.log('\n📝 Generating missing OpenAPI files...');
    await generateMissingFiles(report, false);
  } else if (report.missingFromOpenApi.length > 0 && !writeMode) {
    console.log('\n💡 Run with --write to generate missing OpenAPI files');
  }

  // Exit with error code if there are missing endpoints
  if (report.missingFromOpenApi.length > 0 || report.mismatchedMethods.length > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
