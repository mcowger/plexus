/**
 * Regression tests for unifiedToContext / unifiedToolToPiAi schema conversion.
 *
 * Previously, the 'array' case used Type.Array(Type.Any()), which produced
 * `items: {}` — silently dropping all nested object structure (properties,
 * required, additionalProperties).  The 'object' case was missing entirely,
 * causing nested objects to become Type.Any() as well.
 *
 * This caused models to ignore required fields like `header` and
 * `options[*].description` on the OpenCode `question` tool, producing invalid
 * tool calls that failed Zod validation.
 */

import { describe, expect, test } from "bun:test";
import { unifiedToContext } from "../oauth/type-mappers";
import type { UnifiedChatRequest } from "../../types/unified";

// The full input_schema for OpenCode's `question` tool — the real-world trigger
// for this bug.
const QUESTION_TOOL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object" as const,
  properties: {
    questions: {
      description: "Questions to ask",
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { description: "Complete question", type: "string" },
          header: { description: "Very short label (max 30 chars)", type: "string" },
          options: {
            description: "Available choices",
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { description: "Display text (1-5 words, concise)", type: "string" },
                description: { description: "Explanation of choice", type: "string" }
              },
              required: ["label", "description"],
              additionalProperties: false
            }
          },
          multiple: { description: "Allow selecting multiple choices", type: "boolean" }
        },
        required: ["question", "header", "options"],
        additionalProperties: false
      }
    }
  },
  required: ["questions"],
  additionalProperties: false
};

function buildRequest(toolSchema: typeof QUESTION_TOOL_SCHEMA): UnifiedChatRequest {
  return {
    model: "claude-test",
    messages: [{ role: "user", content: "hello" }],
    tools: [
      {
        type: "function",
        function: {
          name: "question",
          description: "Ask the user questions",
          parameters: toolSchema
        }
      }
    ]
  };
}

function getParams(schema: typeof QUESTION_TOOL_SCHEMA): any {
  const context = unifiedToContext(buildRequest(schema));
  expect(context.tools).toBeDefined();
  expect(context.tools!.length).toBeGreaterThan(0);
  return context.tools![0]!.parameters as any;
}

describe("unifiedToolToPiAi — nested schema preservation", () => {
  test("array items schema is not dropped (regression: Type.Array(Type.Any()))", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);

    // Top-level questions property must be an array
    expect(params.properties.questions.type).toBe("array");

    // items must not be empty — the old bug produced `items: {}`
    const items = params.properties.questions.items;
    expect(items).toBeDefined();
    expect(Object.keys(items).length).toBeGreaterThan(0);
  });

  test("nested object properties are preserved inside array items", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const items = params.properties.questions.items;

    // The items object must have its properties
    expect(items.properties).toBeDefined();
    expect(items.properties.question).toBeDefined();
    expect(items.properties.header).toBeDefined();
    expect(items.properties.options).toBeDefined();
    expect(items.properties.multiple).toBeDefined();
  });

  test("required array on nested object items is preserved", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const items = params.properties.questions.items;

    // required must list question, header, and options — not be missing
    expect(items.required).toEqual(["question", "header", "options"]);
  });

  test("additionalProperties on nested object items is preserved", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const items = params.properties.questions.items;

    expect(items.additionalProperties).toBe(false);
  });

  test("doubly-nested array-of-object schema (options items) is preserved", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const optionsItems = params.properties.questions.items.properties.options.items;

    // options items must have its own properties
    expect(optionsItems).toBeDefined();
    expect(optionsItems.properties?.label).toBeDefined();
    expect(optionsItems.properties?.description).toBeDefined();
  });

  test("required on doubly-nested options items is preserved", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const optionsItems = params.properties.questions.items.properties.options.items;

    expect(optionsItems.required).toEqual(["label", "description"]);
  });

  test("additionalProperties on doubly-nested options items is preserved", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const optionsItems = params.properties.questions.items.properties.options.items;

    expect(optionsItems.additionalProperties).toBe(false);
  });

  test("scalar types within nested objects are correctly typed", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);
    const itemProps = params.properties.questions.items.properties;

    expect(itemProps.question.type).toBe("string");
    expect(itemProps.header.type).toBe("string");
    expect(itemProps.multiple.type).toBe("boolean");
    expect(itemProps.options.type).toBe("array");
  });

  test("descriptions are preserved at all nesting levels", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);

    expect(params.properties.questions.description).toBe("Questions to ask");
    expect(params.properties.questions.items.properties.question.description).toBe("Complete question");
    expect(params.properties.questions.items.properties.header.description).toBe("Very short label (max 30 chars)");
    expect(params.properties.questions.items.properties.options.description).toBe("Available choices");
    expect(params.properties.questions.items.properties.options.items.properties.label.description).toBe("Display text (1-5 words, concise)");
    expect(params.properties.questions.items.properties.options.items.properties.description.description).toBe("Explanation of choice");
  });

  test("top-level tool parameters structure is intact", () => {
    const params = getParams(QUESTION_TOOL_SCHEMA);

    expect(params.type).toBe("object");
    expect(params.required).toEqual(["questions"]);
    expect(params.additionalProperties).toBe(false);
  });
});
