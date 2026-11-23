export interface Bm25MinCovConfig {
  readonly bm25_min_cov: number;
  readonly status: string;
  readonly note: string;
}

declare const bm25MinCovConfig: Bm25MinCovConfig;
export default bm25MinCovConfig;
