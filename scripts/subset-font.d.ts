// subset-font ships without types; these cover the options scripts/subset-fonts.ts uses.
declare module 'subset-font' {
  export default function subsetFont(
    font: Uint8Array,
    text: string,
    options?: {
      targetFormat?: 'sfnt' | 'woff' | 'woff2';
      /** Name table IDs to keep beyond the subsetter's defaults. */
      preserveNameIds?: number[];
    },
  ): Promise<Buffer>;
}
