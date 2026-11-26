/**
 * Pure JSON Schema -> `firebase/ai` SchemaRequest converter (`04` §2.1, §5.1.4).
 *
 * Preserves declaration-order `propertyOrdering` on object nodes and strips
 * unsupported JSON Schema keywords (`$id`, `additionalProperties`).
 */

import type { ObjectSchemaRequest, SchemaRequest } from "firebase/ai";
import { SchemaType } from "firebase/ai";
import type { JsonSchemaNode, JsonSchemaObject } from "@toulmin/schemas";

export function toFirebaseSchema(node: JsonSchemaObject): ObjectSchemaRequest;
export function toFirebaseSchema(node: JsonSchemaNode): SchemaRequest;
export function toFirebaseSchema(node: JsonSchemaNode): SchemaRequest {
  switch (node.type) {
    case "string": {
      const req: SchemaRequest = {
        type: SchemaType.STRING,
        ...(node.enum !== undefined ? { enum: [...node.enum] } : {}),
      };
      return req;
    }
    case "integer": {
      const req: SchemaRequest = {
        type: SchemaType.INTEGER,
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
      };
      return req;
    }
    case "number": {
      const req: SchemaRequest = {
        type: SchemaType.NUMBER,
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
      };
      return req;
    }
    case "boolean": {
      return { type: SchemaType.BOOLEAN };
    }
    case "array": {
      const req: SchemaRequest = {
        type: SchemaType.ARRAY,
        items: toFirebaseSchema(node.items),
        ...(node.minItems !== undefined ? { minItems: node.minItems } : {}),
        ...(node.maxItems !== undefined ? { maxItems: node.maxItems } : {}),
      };
      return req;
    }
    case "object": {
      const keys = Object.keys(node.properties);
      const properties: Record<string, SchemaRequest> = {};
      for (const key of keys) {
        const prop = node.properties[key];
        if (prop !== undefined) {
          properties[key] = toFirebaseSchema(prop);
        }
      }
      const req: ObjectSchemaRequest = {
        type: "object",
        properties,
        required: [...node.required],
        propertyOrdering: keys,
      };
      return req;
    }
  }
}
