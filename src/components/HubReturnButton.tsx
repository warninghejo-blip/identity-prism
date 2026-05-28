import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { startFadeTransition } from '@/lib/fadeTransition';
import { goBack } from '@/lib/safeNavigate';
import './HubReturnButton.css';

type HubReturnButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  fallback?: string;
  onBeforeReturn?: () => void;
};

export default function HubReturnButton({
  className = '',
  fallback,
  onBeforeReturn,
  onClick,
  type = 'button',
  ...props
}: HubReturnButtonProps) {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (onClick) {
        onClick(event);
        return;
      }

      onBeforeReturn?.();
      startFadeTransition(() => goBack(navigate, fallback));
    },
    [fallback, navigate, onBeforeReturn, onClick],
  );

  return (
    <button type={type} className={`hub-return-button ${className}`.trim()} onClick={handleClick} {...props}>
      <span className="hub-return-button__halo" />
      <span className="hub-return-button__text">
        <strong>HUB</strong>
      </span>
    </button>
  );
}
