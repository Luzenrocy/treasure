/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module "*.svg?component" {
  import type { FunctionalComponent, SVGAttributes } from "vue";
  const src: FunctionalComponent<SVGAttributes>;
  export default src;
}

export {};

declare global {
  interface Window {
    __TREASURE_HOST__?: boolean;
  }
}
