import { LogQueryService } from "../../services/log-query";
import type { LogsQuery, LogsDeleteRequest } from "../../types/management";
import { logger } from "../../utils/logger";

export async function handleLogs(req: Request, logQueryService: LogQueryService): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname; // /v0/logs or /v0/logs/:id
  const method = req.method;

  // Check if ID is provided
  const match = path.match(/\/v0\/logs\/([^/]+)$/);
  const id = match ? match[1] : null;

  if (id && method === "GET") {
    // Get Details
    try {
      const details = await logQueryService.getLogDetails(id);
      if (!details) {
        return new Response("Log not found", { status: 404 });
      }
      return Response.json(details);
    } catch (error) {
      logger.error("Failed to get log details", { id, error });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  if (id && method === "DELETE") {
    // Delete by ID
    try {
      const result = await logQueryService.deleteLogById(id);
      if (!result.success) {
        return new Response("Log not found", { status: 404 });
      }
      return Response.json(result);
    } catch (error) {
      logger.error("Failed to delete log by ID", { id, error });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  if (method === "GET") {
    // Query Logs
    try {
      const params = url.searchParams;
      const query: LogsQuery = {
        type: (params.get("type") as any) || "usage",
        limit: params.has("limit") ? parseInt(params.get("limit")!) : 100,
        offset: params.has("offset") ? parseInt(params.get("offset")!) : 0,
        provider: params.get("provider") || undefined,
        model: params.get("model") || undefined,
        apiKey: params.get("apiKey") || undefined,
        success: params.has("success") ? params.get("success") === "true" : undefined,
        startDate: params.get("startDate") || undefined,
        endDate: params.get("endDate") || undefined,
      };

      const result = await logQueryService.queryLogs(query);
      return Response.json(result);
    } catch (error) {
      logger.error("Failed to query logs", { error });
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  if (method === "DELETE") {
    // Bulk Delete Logs
    try {
      const body = await req.json() as LogsDeleteRequest;
      const result = await logQueryService.deleteLogs(body);
      return Response.json(result);
    } catch (error) {
        logger.error("Failed to delete logs", { error });
        return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
