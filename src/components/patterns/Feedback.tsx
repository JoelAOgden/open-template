import type { ReactNode, HTMLAttributes } from 'react';
import { Text, Heading } from '../ui/Typography';
export function ErrorState({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) { return <Text {...props} role="alert" tone="danger">{children}</Text>; }
export function LoadingState({ children = 'Loading…' }: { children?: ReactNode ;}) { return <Text role="status">{children}</Text>; }
export function EmptyState({ title, children }: { title: string; children?: ReactNode ;}) { return <div className="empty-state"><Heading>{title}</Heading><Text tone="muted">{children}</Text></div>; }
