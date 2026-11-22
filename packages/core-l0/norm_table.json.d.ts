export interface NormTable {
  readonly latin_compose: Readonly<Record<string, string>>;
  readonly map: Readonly<Record<string, string>>;
  readonly lower_overrides: Readonly<Record<string, string>>;
  readonly latin_fold: Readonly<Record<string, string>>;
  readonly compat_fold: Readonly<Record<string, string>>;
  readonly confusables: Readonly<Record<string, string>>;
  readonly SYMBOL_PUA_TABLE: Readonly<Record<string, string>>;
}

declare const normTable: NormTable;
export default normTable;
