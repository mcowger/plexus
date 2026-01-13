import { z } from "zod";

export type ErrorType =
  | "authentication_error"
  | "invalid_request_error"
  | "rate_limit_error"
  | "api_error"
  | "provider_error";

export const PlexusErrorSchema = z.object({
  error: z.object({
    type: z.string(),
    message: z.string(),
    code: z.string().optional(),
    param: z.string().optional(),
  }),
});

export type PlexusError = z.infer<typeof PlexusErrorSchema>;

/**
 * Structured error class for Plexus errors
 */
export class PlexusErrorResponse extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public status: number,
    public code?: string,
    public param?: string
  ) {
    super(message);
    this.name = "PlexusErrorResponse";
  }

  toJSON(): PlexusError {
    return {
      error: {
        type: this.type,
        message: this.message,
        code: this.code,
        param: this.param,
      },
    };
  }

  toResponse(): Response {
    return Response.json(this.toJSON(), { status: this.status });
  }
}
