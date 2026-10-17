declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** js-yaml (bundled into the window): only load is used — a Swagger / OpenAPI description in YAML. */
declare module 'js-yaml' {
  export function load(text: string): unknown
}
