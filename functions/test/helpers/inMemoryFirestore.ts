import type {
  CollectionRefLike,
  DocRefLike,
  DocSnapshotLike,
  FirestoreLike,
  QueryLike,
  QuerySnapshotLike,
  TransactionLike,
} from "../../src/common/counters.js";

interface IncrementOp {
  readonly __op: "increment";
  readonly delta: number;
}

function isIncrementOp(v: unknown): v is IncrementOp {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __op?: unknown }).__op === "increment" &&
    typeof (v as { delta?: unknown }).delta === "number"
  );
}

function deepClone<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return new Date(v.getTime()) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepClone(x)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = deepClone(val);
  }
  return out as T;
}

function applyFieldWrites(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  merge: boolean
): Record<string, unknown> {
  const target: Record<string, unknown> = merge ? deepClone(base) : {};
  for (const [key, val] of Object.entries(patch)) {
    if (isIncrementOp(val)) {
      const prev = typeof target[key] === "number" ? (target[key] as number) : 0;
      target[key] = prev + val.delta;
    } else {
      target[key] = deepClone(val);
    }
  }
  return target;
}

function makeSnapshot(id: string, record: Record<string, unknown> | undefined): DocSnapshotLike {
  return {
    id,
    exists: record !== undefined,
    data: () => (record !== undefined ? deepClone(record) : undefined),
    get: (field: string) => (record !== undefined ? deepClone(record[field]) : undefined),
  };
}

export class InMemoryFirestore implements FirestoreLike {
  private docs = new Map<string, Record<string, unknown>>();

  seedDoc(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, deepClone(data));
  }

  getDocData(path: string): Record<string, unknown> | undefined {
    const raw = this.docs.get(path);
    return raw ? deepClone(raw) : undefined;
  }

  listDocs(prefix = ""): Array<{ path: string; data: Record<string, unknown> }> {
    const res: Array<{ path: string; data: Record<string, unknown> }> = [];
    for (const [path, data] of this.docs.entries()) {
      if (path.startsWith(prefix)) {
        res.push({ path, data: deepClone(data) });
      }
    }
    return res.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  doc(path: string): DocRefLike {
    const parts = path.split("/");
    const id = parts[parts.length - 1] ?? "";
    return {
      id,
      path,
      get: async () => makeSnapshot(id, this.docs.get(path)),
    };
  }

  collection(collectionPath: string): CollectionRefLike {
    const prefix = `${collectionPath}/`;

    const buildQuery = (
      filters: Array<{ op: "==" | ">=" | "<"; value: string }>,
      limitCount?: number
    ): QueryLike => ({
      where: (_field, op, value) => buildQuery([...filters, { op, value: String(value) }], limitCount),
      limit: (n) => buildQuery(filters, n),
      get: async (): Promise<QuerySnapshotLike> => {
        const matched: DocSnapshotLike[] = [];
        for (const [docPath, data] of this.docs.entries()) {
          if (!docPath.startsWith(prefix)) continue;
          const rest = docPath.slice(prefix.length);
          if (rest.includes("/")) continue;
          const docId = rest;
          let ok = true;
          for (const f of filters) {
            if (f.op === "==" && docId !== f.value) ok = false;
            if (f.op === ">=" && !(docId >= f.value)) ok = false;
            if (f.op === "<" && !(docId < f.value)) ok = false;
          }
          if (ok) {
            matched.push(makeSnapshot(docId, data));
          }
        }
        matched.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const sliced = limitCount !== undefined ? matched.slice(0, limitCount) : matched;
        return {
          empty: sliced.length === 0,
          docs: sliced,
        };
      },
    });

    return {
      doc: (id: string) => this.doc(`${collectionPath}/${id}`),
      where: (field, op, value) => buildQuery([]).where(field, op, value),
    };
  }

  async runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
    const working = new Map<string, Record<string, unknown>>();
    for (const [k, v] of this.docs.entries()) {
      working.set(k, deepClone(v));
    }

    const pendingWrites: Array<() => void> = [];
    const tx: TransactionLike = {
      get: async (ref) => makeSnapshot(ref.id, working.get(ref.path)),
      set: (ref, data, options) => {
        pendingWrites.push(() => {
          const existing = working.get(ref.path) ?? {};
          working.set(ref.path, applyFieldWrites(existing, data, options?.merge === true));
        });
      },
      update: (ref, data) => {
        pendingWrites.push(() => {
          const existing = working.get(ref.path);
          if (!existing) {
            throw new Error(`Document does not exist for update: ${ref.path}`);
          }
          working.set(ref.path, applyFieldWrites(existing, data, true));
        });
      },
    };

    const result = await fn(tx);
    for (const apply of pendingWrites) {
      apply();
    }
    this.docs = working;
    return result;
  }

  increment(delta: number): unknown {
    return { __op: "increment", delta } satisfies IncrementOp;
  }
}
