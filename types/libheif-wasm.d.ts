// The browser build of libheif-js (lib/heif-decode.ts): the parts of its
// JavaScript API that are used, which its own declarations do not describe.
declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number },
      done: (shown: { data: Uint8ClampedArray<ArrayBuffer> } | null) => void,
    ): void;
    free(): void;
  }
  interface LibHeif {
    ready?: Promise<unknown>;
    HeifDecoder: new () => { decode(buffer: Uint8Array): HeifImage[]; decoder: { delete(): void } };
  }
  const load: (options?: Record<string, unknown>) => LibHeif;
  export default load;
}
