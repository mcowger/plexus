-- Add 'ollama' to quota_checker_type enum for Ollama quota checker support
ALTER TYPE "public"."quota_checker_type" ADD VALUE 'ollama';
