declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

/** js-yaml (bundled into the window): YAML read (Swagger / OpenAPI, the tools) and written (the tools). */
declare module 'js-yaml' {
  export function load(text: string): unknown
  export function dump(value: unknown, opts?: { indent?: number; lineWidth?: number; noRefs?: boolean; sortKeys?: boolean; flowLevel?: number; forceQuotes?: boolean }): string
}
