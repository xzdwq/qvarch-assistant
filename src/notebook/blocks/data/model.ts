import { load as yamlLoad } from 'js-yaml'
import type { UnrunValue } from '../../domain/blockSpec'

/** A data block's value: its JSON / YAML parsed (empty JSON — null); a parse error — its first line. */
export function dataValueOf(lang: string, body: string): UnrunValue {
  try {
    return { value: lang === 'yaml' ? yamlLoad(body) : JSON.parse(body || 'null') }
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).split('\n')[0] }
  }
}
