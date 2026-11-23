export interface PorterSuffixRule {
  readonly suffix: string;
  readonly replacement: string;
  readonly minMeasure?: number;
  readonly requiresVowel?: boolean;
  readonly stemEndsWithAny?: readonly string[];
}

export interface PorterV1Table {
  readonly version: string;
  readonly standard: string;
  readonly vowels: readonly string[];
  readonly step1a: readonly PorterSuffixRule[];
  readonly step1b: {
    readonly eed: PorterSuffixRule;
    readonly pastOrProg: readonly PorterSuffixRule[];
    readonly cleanupAppendE: readonly string[];
    readonly doubleConsonantKeep: readonly string[];
    readonly appendEOnMeasure1AndStarO: boolean;
  };
  readonly step1c: readonly PorterSuffixRule[];
  readonly step2: readonly PorterSuffixRule[];
  readonly step3: readonly PorterSuffixRule[];
  readonly step4: readonly PorterSuffixRule[];
  readonly step5a: {
    readonly suffix: string;
    readonly removeIfMeasureGt: number;
    readonly removeIfMeasureEqAndNotStarO: number;
  };
  readonly step5b: {
    readonly suffix: string;
    readonly requiresDoubleConsonant: boolean;
    readonly minMeasure: number;
  };
}

declare const porterV1: PorterV1Table;
export default porterV1;
