import { XMLParser } from "fast-xml-parser";
import type { OrderedXmlNode } from "./chunk.js";
export { buildSanitizedSections, resanitizeCachedSections } from "./chunk.js";

const helperParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function parseXmlOrderedFromText(xmlText: string): OrderedXmlNode[] {
  return helperParser.parse(xmlText) as OrderedXmlNode[];
}
