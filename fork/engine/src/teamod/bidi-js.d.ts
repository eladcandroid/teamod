// The parts of bidi-js (MIT, https://github.com/lojjic/bidi-js) teamod uses; it ships no types.
declare module 'bidi-js' {
  interface EmbeddingLevels {
    readonly levels: Uint8Array;
    readonly paragraphs: ReadonlyArray<{ readonly start: number; readonly end: number; readonly level: number }>;
  }
  interface Bidi {
    getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl'): EmbeddingLevels;
    getReorderSegments(text: string, levels: EmbeddingLevels, start?: number, end?: number): Array<[number, number]>;
    getMirroredCharactersMap(text: string, levels: EmbeddingLevels, start?: number, end?: number): Map<number, string>;
  }
  export default function bidiFactory(): Bidi;
}
