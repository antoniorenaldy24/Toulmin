import js from "@eslint/js";
import tseslint from "typescript-eslint";

const CORE_L0_FORBIDDEN_PATHS = [
  "firebase",
  "fs",
  "net",
  "http",
  "https",
  "http2",
  "dgram",
  "dns",
  "tls",
  "crypto",
  "child_process",
  "worker_threads",
  "os",
  "path",
  "url",
  "stream",
  "process",
  "timers",
  "perf_hooks",
  "vm",
  "cluster",
  "readline",
  "zlib",
  "undici",
  "axios",
  "node-fetch",
  "ws",
  "jsdom",
  "dexie",
  "comlink"
];

const CORE_L0_FORBIDDEN_PATTERNS = [
  "firebase/*",
  "@firebase/*",
  "node:*",
  "fs/*",
  "stream/*",
  "timers/*"
];

const CORE_L0_FORBIDDEN_GLOBALS = [
  { name: "window", message: "DOM APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "document", message: "DOM APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "navigator", message: "DOM APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "localStorage", message: "DOM storage is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "sessionStorage", message: "DOM storage is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "indexedDB", message: "IndexedDB is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "location", message: "DOM globals are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "history", message: "DOM globals are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "self", message: "Global worker/window self is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "HTMLElement", message: "DOM types/globals are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "Node", message: "DOM Node is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "DOMParser", message: "DOM APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "fetch", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "XMLHttpRequest", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "WebSocket", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "EventSource", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "Request", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "Response", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "Headers", message: "Network APIs are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "AbortController", message: "Network/abort globals are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "setTimeout", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "clearTimeout", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "setInterval", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "clearInterval", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "setImmediate", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "clearImmediate", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "queueMicrotask", message: "Scheduling microtasks is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "requestAnimationFrame", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "cancelAnimationFrame", message: "Scheduling timers are forbidden in packages/core-l0 (00 §7.1)." },
  { name: "process", message: "Node process global is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "Buffer", message: "Node Buffer global is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "global", message: "Node global is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "globalThis", message: "Global namespace object globalThis is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "crypto", message: "Runtime crypto global is forbidden in packages/core-l0 (00 §7.1, 02 §2.3)." },
  { name: "Intl", message: "Platform Intl APIs are forbidden in packages/core-l0 (02 §4)." },
  { name: "TextEncoder", message: "Web TextEncoder global is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "TextDecoder", message: "Web TextDecoder global is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "atob", message: "Global base64 atob() is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "btoa", message: "Global base64 btoa() is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "URL", message: "Web URL global is forbidden in packages/core-l0 (00 §7.1)." },
  { name: "structuredClone", message: "Global structuredClone() is forbidden in packages/core-l0 (00 §7.1)." }
];

const CORE_L0_SRC_EXTRA_GLOBALS = [
  ...CORE_L0_FORBIDDEN_GLOBALS,
  { name: "Date", message: "Clock access (Date) is forbidden in pure L0 source (01 §2.1, 00 §7.1)." },
  { name: "performance", message: "Clock access (performance) is forbidden in pure L0 source (00 §7.1)." }
];

function splitTopLevelAlternatives(body) {
  const branches = [];
  let inCharClass = false;
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (inCharClass) {
      if (ch === "]") inCharClass = false;
      i += 1;
      continue;
    }
    if (ch === "[") {
      inCharClass = true;
    } else if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      if (depth > 0) depth -= 1;
    } else if (ch === "|" && depth === 0) {
      branches.push(body.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  branches.push(body.slice(start));
  return branches;
}

function stripGroupPrefix(branch) {
  let s = branch;
  if (s.startsWith("?:")) s = s.slice(2);
  // Peel leading non-capturing/capturing group openers if any
  while (s.startsWith("(?:")) {
    s = s.slice(3);
  }
  return s;
}

function hasOverlappingAlternatives(groupBody) {
  const cleanBody = groupBody.startsWith("?:") ? groupBody.slice(2) : groupBody;
  if (!cleanBody.includes("|")) return false;
  const branches = splitTopLevelAlternatives(cleanBody);
  if (branches.length < 2) return false;

  const firstTokens = [];
  for (const b of branches) {
    const s = stripGroupPrefix(b);
    if (s.length === 0) return true; // empty alternative inside quantified group
    if (s[0] === "." || s[0] === "[") {
      firstTokens.push("*"); // wildcard/class may overlap other branches
    } else if (s[0] === "\\") {
      firstTokens.push(s.slice(0, 2));
    } else {
      firstTokens.push(s[0]);
    }
  }

  for (let a = 0; a < firstTokens.length; a += 1) {
    for (let b = a + 1; b < firstTokens.length; b += 1) {
      if (firstTokens[a] === "*" || firstTokens[b] === "*" || firstTokens[a] === firstTokens[b]) {
        return true;
      }
    }
  }
  return false;
}

function analyzeRegexPattern(pattern) {
  const implicitFound = [];
  let hasNestedUnbounded = false;
  let inCharClass = false;
  const groupStack = [];

  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) {
        i += 1;
        continue;
      }
      if ("wWbBsSdD".includes(next)) {
        implicitFound.push("\\" + next);
      } else if ((next === "p" || next === "P") && pattern[i + 2] === "{") {
        implicitFound.push("\\" + next + "{...}");
      }
      i += 2;
      continue;
    }

    if (inCharClass) {
      if (ch === "]") {
        inCharClass = false;
      }
      i += 1;
      continue;
    }

    if (ch === "[") {
      inCharClass = true;
      i += 1;
      continue;
    }

    if (ch === "(") {
      groupStack.push({ startIndex: i + 1, hasUnboundedInner: false });
      i += 1;
      continue;
    }

    if (ch === ")") {
      const frame = groupStack.pop();
      const groupBody = frame ? pattern.slice(frame.startIndex, i) : "";
      let j = i + 1;
      let isUnbounded = false;
      const q = pattern[j];
      if (q === "*" || q === "+") {
        isUnbounded = true;
        j += 1;
        if (pattern[j] === "?" || pattern[j] === "+") {
          j += 1;
        }
      } else if (q === "{") {
        const braceClose = pattern.indexOf("}", j + 1);
        if (braceClose !== -1) {
          const body = pattern.slice(j + 1, braceClose);
          if (/^[0-9]+,$/.test(body) || /^[0-9]+,[0-9]+$/.test(body) || /^[0-9]+$/.test(body)) {
            if (body.endsWith(",")) {
              isUnbounded = true;
            }
            j = braceClose + 1;
            if (pattern[j] === "?") {
              j += 1;
            }
          }
        }
      }

      if (frame && isUnbounded && (frame.hasUnboundedInner || hasOverlappingAlternatives(groupBody))) {
        hasNestedUnbounded = true;
      }
      if (frame && (frame.hasUnboundedInner || isUnbounded) && groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasUnboundedInner = true;
      }
      i = j;
      continue;
    }

    // Top-level or in-group quantifier on single atom
    if ((ch === "*" || ch === "+") && groupStack.length > 0) {
      groupStack[groupStack.length - 1].hasUnboundedInner = true;
    } else if (ch === "{") {
      const braceClose = pattern.indexOf("}", i + 1);
      if (braceClose !== -1) {
        const body = pattern.slice(i + 1, braceClose);
        if (/^[0-9]+,$/.test(body) && groupStack.length > 0) {
          groupStack[groupStack.length - 1].hasUnboundedInner = true;
        }
      }
    }

    i += 1;
  }

  return {
    implicitFound,
    hasNestedUnbounded
  };
}

const toulminPlugin = {
  rules: {
    "no-implicit-l0-regex": {
      meta: {
        type: "problem",
        docs: {
          description: "Forbid implicit regex character classes and nested unbounded quantifiers in pure L0 (02 §1.4, 00 §7.3)."
        },
        schema: []
      },
      create(context) {
        function checkPattern(node, pattern) {
          const result = analyzeRegexPattern(pattern);
          if (result.implicitFound.length > 0) {
            context.report({
              node,
              message: `Implicit regex class/escape (${result.implicitFound.join(", ")}) is forbidden in packages/core-l0 (02 §1.4). Use explicit unicode_15_1.bin character classes.`
            });
          }
          if (result.hasNestedUnbounded) {
            context.report({
              node,
              message: "Nested unbounded regex quantifier is forbidden in packages/core-l0 (00 §7.3, 02 §1.4)."
            });
          }
        }

        return {
          Literal(node) {
            if (node.regex) {
              checkPattern(node, node.regex.pattern);
            }
          },
          NewExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "RegExp") {
              const first = node.arguments[0];
              if (!first) return;
              if (first.type === "Literal" && typeof first.value === "string") {
                checkPattern(node, first.value);
              } else if (first.type === "TemplateLiteral" && first.expressions.length === 0) {
                checkPattern(node, first.quasis[0]?.value.cooked ?? "");
              } else {
                context.report({
                  node,
                  message: "Dynamic RegExp patterns are forbidden in packages/core-l0 (02 §1.4)."
                });
              }
            }
          },
          CallExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "RegExp") {
              const first = node.arguments[0];
              if (!first) return;
              if (first.type === "Literal" && typeof first.value === "string") {
                checkPattern(node, first.value);
              } else if (first.type === "TemplateLiteral" && first.expressions.length === 0) {
                checkPattern(node, first.quasis[0]?.value.cooked ?? "");
              } else {
                context.report({
                  node,
                  message: "Dynamic RegExp patterns are forbidden in packages/core-l0 (02 §1.4)."
                });
              }
            }
          }
        };
      }
    }
  }
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      ".agents/**",
      ".validator-scratch/**",
      "docs/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs}"],
    ignores: ["packages/firebase-client/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["firebase/ai", "firebase/ai/*", "@firebase/ai", "@firebase/ai/*"],
              message: "Firebase AI Logic (firebase/ai) may only be imported inside packages/firebase-client (00 §7.2, 06 §5.3)."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["packages/core-l0/**/*.{ts,tsx,mts,cts,js,mjs}"],
    ignores: ["packages/core-l0/vitest.config.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: CORE_L0_FORBIDDEN_PATHS.map((name) => ({
            name,
            message: "packages/core-l0 must remain 100% pure: no Firebase, DOM, network, Node I/O, crypto, or scheduling imports (00 §7.1, 06 §5.3)."
          })),
          patterns: [
            {
              group: CORE_L0_FORBIDDEN_PATTERNS,
              message: "packages/core-l0 must remain 100% pure: no Firebase, DOM, network, Node I/O, crypto, or scheduling imports (00 §7.1, 06 §5.3)."
            }
          ]
        }
      ],
      "no-restricted-globals": ["error", ...CORE_L0_FORBIDDEN_GLOBALS],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Unseeded Math.random() is forbidden in packages/core-l0 (00 §7.1)."
        },
        {
          property: "normalize",
          message: "Platform String.prototype.normalize() (NFC/NFKC) is forbidden in packages/core-l0 (02 §2.2)."
        },
        {
          property: "toLowerCase",
          message: "Runtime toLowerCase() is forbidden in packages/core-l0; use normLower() and unicode_15_1.bin (02 §2.3)."
        },
        {
          property: "toLocaleLowerCase",
          message: "Runtime toLocaleLowerCase() is forbidden in packages/core-l0 (02 §2.3)."
        },
        {
          property: "toUpperCase",
          message: "Runtime toUpperCase() is forbidden in packages/core-l0 (02 §2.3)."
        },
        {
          property: "toLocaleUpperCase",
          message: "Runtime toLocaleUpperCase() is forbidden in packages/core-l0 (02 §2.3)."
        },
        {
          property: "localeCompare",
          message: "Locale-dependent localeCompare() is forbidden in packages/core-l0 (02 §1.4)."
        }
      ]
    }
  },
  {
    files: ["packages/core-l0/src/**/*.ts"],
    plugins: {
      toulmin: toulminPlugin
    },
    rules: {
      "no-restricted-globals": ["error", ...CORE_L0_SRC_EXTRA_GLOBALS],
      "toulmin/no-implicit-l0-regex": "error"
    }
  },
  {
    files: [
      "packages/schemas/src/**/*.ts",
      "packages/prompts/src/**/*.ts",
      "packages/copy/src/**/*.ts"
    ],
    plugins: {
      toulmin: toulminPlugin
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: CORE_L0_FORBIDDEN_PATHS.map((name) => ({
            name,
            message: "packages/{schemas,prompts,copy} must remain 100% pure: no Firebase, DOM, network, Node I/O, crypto, or scheduling imports (00 §7.1, 06 §5.3)."
          })),
          patterns: [
            {
              group: CORE_L0_FORBIDDEN_PATTERNS,
              message: "packages/{schemas,prompts,copy} must remain 100% pure: no Firebase, DOM, network, Node I/O, crypto, or scheduling imports (00 §7.1, 06 §5.3)."
            }
          ]
        }
      ],
      "no-restricted-globals": ["error", ...CORE_L0_SRC_EXTRA_GLOBALS],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Unseeded Math.random() is forbidden in packages/{schemas,prompts,copy} (00 §7.1)."
        }
      ],
      "toulmin/no-implicit-l0-regex": "error"
    }
  },
  {
    files: ["functions/src/oaparse/**/*.{ts,tsx,mts,cts,js,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "undici", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "axios", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node-fetch", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "http", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "https", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "http2", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "net", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "tls", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "dns", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "dgram", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "ws", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:http", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:https", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:http2", message: "HTTP clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:net", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:tls", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:dns", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "node:dgram", message: "Network modules are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "@google-cloud/secret-manager", message: "Secret Manager clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
            { name: "firebase-admin", message: "Firebase Admin SDK is forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." }
          ],
          patterns: [
            {
              group: ["@google-cloud/secret-manager/*"],
              message: "Secret Manager clients are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)."
            },
            {
              group: ["firebase-admin/*"],
              message: "Firebase Admin SDK is forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)."
            },
            {
              group: ["firebase/ai", "firebase/ai/*", "@firebase/ai", "@firebase/ai/*"],
              message: "Firebase AI Logic is forbidden outside packages/firebase-client (00 §7.2, 06 §5.3)."
            }
          ]
        }
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Network API fetch() is forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
        { name: "XMLHttpRequest", message: "Network APIs are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
        { name: "WebSocket", message: "Network APIs are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
        { name: "EventSource", message: "Network APIs are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
        { name: "Request", message: "Network APIs are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
        { name: "Response", message: "Network APIs are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." },
        { name: "Headers", message: "Network APIs are forbidden in functions/src/oaparse/** (05 §3.2.4, 06 §5.3)." }
      ]
    }
  },
  {
    files: ["apps/web/**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "firebase",
              message: "apps/web MUST route all Firebase calls through @toulmin/firebase-client (00 §7.2, 06 §5.3)."
            }
          ],
          patterns: [
            {
              group: ["firebase/*", "@firebase/*"],
              message: "apps/web MUST NOT import firebase/* directly; use @toulmin/firebase-client (00 §7.2, 06 §5.3)."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "innerHTML",
          message: "Direct innerHTML assignment is forbidden in apps/web/src under Trusted Types (05 §2.3, AC-SEC-04)."
        },
        {
          property: "outerHTML",
          message: "Direct outerHTML assignment is forbidden in apps/web/src under Trusted Types (05 §2.3)."
        },
        {
          property: "insertAdjacentHTML",
          message: "insertAdjacentHTML is forbidden in apps/web/src under Trusted Types (05 §2.3)."
        },
        {
          property: "srcdoc",
          message: "iframe srcdoc is forbidden in apps/web/src; use Blob URLs with sandbox (04 §4.4, 05 §2.3, AC-GND-02)."
        },
        {
          object: "document",
          property: "write",
          message: "document.write is forbidden in apps/web/src (05 §2.3)."
        }
      ]
    }
  }
);
