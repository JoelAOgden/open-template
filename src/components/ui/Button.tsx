import { forwardRef, type ButtonHTMLAttributes } from 'react';
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'small' | 'medium' | 'large'; iconOnly?: boolean; loading?: boolean ;};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'medium', iconOnly = false, loading = false, className = '', disabled, type = 'button', children, ...props }, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-size={size} className={`ui-button ${variant === 'secondary' ? '' : variant} ${iconOnly ? 'icon-button' : ''} ${className}`}>{loading && <span className="button-spinner" aria-hidden="true" />}{children}</button>;
});
