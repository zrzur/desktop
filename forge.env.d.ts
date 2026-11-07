/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// handled by the Vite build
declare module "*?asset" {
  const url: string;
  export default url;
}
declare module "*.css";
