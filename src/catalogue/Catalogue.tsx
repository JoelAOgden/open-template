import { Field } from "../components/ui/Field";
import { Tooltip } from "../components/ui/Tooltip";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Select, Option } from '../components/ui/Select';
import { Input, Textarea } from '../components/ui/Fields';
import { Heading, Text, CodeBlock } from '../components/ui/Typography';
import { Tabs, Tab, TabPanel } from '../components/ui/Tabs';
import { Stack, Row, Panel } from '../components/layout/Layout';
import { ErrorState, LoadingState, EmptyState } from '../components/patterns/Feedback';
import { ViewHeader, Actions } from '../components/patterns/View';
import { useConfirm } from '../components/patterns/ConfirmDialog';
export default function Catalogue() {
  const [value, setValue] = useState('one'), [tab, setTab] = useState('controls'); const confirm = useConfirm();
  return <Panel className="component-catalogue"><Stack>
    <ViewHeader><Heading level={1}>Component catalogue</Heading><Text tone="muted">Development only · keyboard, focus and state examples</Text></ViewHeader>
    <Tabs aria-label="Examples"><Tab id="controls-tab" aria-controls="controls" aria-selected={tab === 'controls'} onClick={() => setTab('controls')}>Controls</Tab><Tab id="feedback-tab" aria-controls="feedback" aria-selected={tab === 'feedback'} onClick={() => setTab('feedback')}>Feedback</Tab></Tabs>
    <TabPanel id="controls" aria-labelledby="controls-tab" hidden={tab !== 'controls'}><Stack>
      <Heading>Buttons</Heading><Row>{(['primary', 'secondary', 'quiet', 'danger'] as const).map(variant => <Button key={variant} variant={variant}>{variant}</Button>)}<Tooltip label="Example tooltip"><Button>Help</Button></Tooltip><Button disabled>Disabled</Button><Button loading>Loading</Button></Row>
      <Heading>Fields and dropdowns</Heading><Field label="Name" hint="The name shown in the project menu"><Input placeholder="Project name" /></Field><Field label="Description"><Textarea rows={3} /></Field>
      {(['field', 'compact', 'quiet'] as const).map(variant => <Select key={variant} aria-label={`${variant} dropdown`} variant={variant} value={value} onChange={e => setValue(e.target.value)}><Option value="one">First choice</Option><Option value="two">A longer option that can wrap inside the custom dropdown</Option><Option value="disabled" disabled>Unavailable choice</Option></Select>)}
      <Actions><Button onClick={() => void confirm('This confirmation uses the same focus and dismissal handling as the application.', { title: 'Example confirmation' })}>Open confirmation</Button></Actions>
    </Stack></TabPanel>
    <TabPanel id="feedback" aria-labelledby="feedback-tab" hidden={tab !== 'feedback'}><Stack><StatusBadge status="completed">Completed</StatusBadge><LoadingState /><ErrorState>Example error with an actionable explanation.</ErrorState><EmptyState title="No items yet">Add an item to get started.</EmptyState><Text tone="muted">Secondary text</Text><CodeBlock>Example code or process output</CodeBlock></Stack></TabPanel>
  </Stack></Panel>;
}
