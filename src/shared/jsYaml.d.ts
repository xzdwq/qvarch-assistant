/** js-yaml: YAML read (Swagger / OpenAPI, data blocks, the tools) and written (the tools). Shared by the window and the run engine. */
declare module 'js-yaml' {
  export function load(text: string): unknown
  export function dump(value: unknown, opts?: { indent?: number; lineWidth?: number; noRefs?: boolean; sortKeys?: boolean; flowLevel?: number; forceQuotes?: boolean }): string
}
