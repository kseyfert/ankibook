import type { ReactNode } from 'react';
import './Button.css';

export function Button({
                         children, onClick, variant = 'default', disabled, type = 'button',
                       }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'quiet';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button className={`btn btn--${variant}`} onClick={onClick} disabled={disabled} type={type}>
      {children}
    </button>
  );
}