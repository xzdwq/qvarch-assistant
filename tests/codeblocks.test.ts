import { describe, expect, it } from 'vitest'
import { formatCode } from '../src/shared/codeformat'

describe('notebook code blocks', () => {
  it('SQL: keywords upper case, clauses on their lines', async () => {
    const out = await formatCode('sql', 'select id, name from users u where u.age > 18 and u.active = true order by name')
    expect(out).toContain('SELECT')
    expect(out).toContain('\nFROM')
    expect(out).toContain('\nWHERE')
    expect(out).toContain('ORDER BY')
  })
  it('JSON: two-space indents', async () => {
    expect(await formatCode('json', '{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })
  it('JS and HTML through prettier; the block indent is kept', async () => {
    expect(await formatCode('javascript', 'const a={b:1,c:[1,2]};function f(x){return x*2}')).toContain('function f(x) {\n  return x * 2;\n}')
    expect(await formatCode('html', '<div><p>a</p><span>b</span></div>')).toContain('<p>a</p>')
    expect(await formatCode('json', '  {"a":1}')).toBe('  {\n    "a": 1\n  }')
  })
  it('YAML through prettier: indents evened, comments kept', async () => {
    expect(await formatCode('yaml', 'a:   1\nb:\n    - x   # first\n    - y')).toBe('a: 1\nb:\n  - x # first\n  - y')
    await expect(formatCode('yaml', 'a: [1, 2')).rejects.toBeTruthy()
  })
  it('bash: bodies indented', async () => {
    expect(await formatCode('bash', 'if [ -f x ]; then\necho hi\nfi')).toBe('if [ -f x ]; then\n  echo hi\nfi')
  })
  it('broken code is an error, not garbage', async () => {
    await expect(formatCode('javascript', 'function (')).rejects.toBeTruthy()
  })
})
