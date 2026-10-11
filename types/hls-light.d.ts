// hls.js ships types for its full build only. The light build (no subtitles,
// no DRM, no alternate audio, which Stream's renditions do not need) has the
// same API, so it borrows them.
declare module "hls.js/light" {
  export { default } from "hls.js";
  export * from "hls.js";
}
