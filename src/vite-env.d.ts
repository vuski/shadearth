/// <reference types="vite/client" />

declare module "*.glsl" {
  const content: string;
  export default content;
}

declare module "*.vert.glsl" {
  const content: string;
  export default content;
}

declare module "*.frag.glsl" {
  const content: string;
  export default content;
}
