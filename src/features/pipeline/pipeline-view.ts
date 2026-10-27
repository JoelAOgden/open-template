export const statusLabel: Record<string, string> = { pending: 'Waiting', running: 'In progress', completed: 'Complete', attention: 'Needs attention', paused: 'Paused', ready: 'Ready', blocked: 'Needs attention', failed: 'Needs attention', review: 'Ready to accept', accepted: 'Changes accepted', dismissed: 'Dismissed', stopped: 'Paused', skipped: 'Skipped' };

export function runStatusLabel(run:{status:string;cancelled?:boolean;rolledBack?:boolean;applying?:boolean;acceptancePolicy?:string}) {
  return run.cancelled ? 'Cancelled' : run.rolledBack ? 'Previous version restored' : run.applying ? 'Applying changes' : run.status==='accepted'&&run.acceptancePolicy==='automatic' ? 'Changes applied' : statusLabel[run.status]??run.status;
}
