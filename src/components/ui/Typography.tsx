import type { HTMLAttributes, Ref } from 'react';
export function Text({ tone = 'default', ...props }: HTMLAttributes<HTMLParagraphElement> & { tone?: 'default' | 'muted' | 'danger' ;}) { return <p data-tone={tone} {...props} />; }
export function Heading({ level = 2, ...props }: HTMLAttributes<HTMLHeadingElement> & { level?: 1 | 2 | 3 | 4 | 5 | 6; ref?: Ref<HTMLHeadingElement> ;}) { const Tag = `h${level}` as 'h1'; return <Tag {...props} />; }
export function CodeBlock(props: HTMLAttributes<HTMLPreElement>) { return <pre {...props} />; }
