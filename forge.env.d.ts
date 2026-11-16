/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// handled by the Vite build
declare module "*?asset" {
  const url: string;
  export default url;
}
declare module "*.css";
// file contents as text / as a data: URL (the start-up page embeds its
// logo and fonts)
declare module "*?raw" {
  const text: string;
  export default text;
}
declare module "*?inline" {
  const url: string;
  export default url;
}
