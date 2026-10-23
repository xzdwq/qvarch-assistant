import { fenceBodyLines } from '../../domain/fence'

/** The diagram component's model: a ```mermaid fence, its body — the Mermaid source. */
export const mermaidBody = (src: string) => fenceBodyLines(src).join('\n')
export const mermaidMd = (body: string) => `\`\`\`mermaid\n${body.replace(/\n+$/, '')}\n\`\`\``
/** A new diagram's example. */
export const NEW_MERMAID = 'flowchart LR\n  A[Заявка] --> B{Проверка}\n  B -- да --> C[В работу]\n  B -- нет --> D[Отказ]'
