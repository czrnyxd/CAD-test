import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Dialog of the design system: title bar with "Zamknij", body and an optional footer with the actions. */
export function Dialog({
  title,
  width = 880,
  onClose,
  footer,
  children,
  className,
}: {
  title: string;
  width?: number;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // Esc closes the dialog (the topmost one only, when dialogs are stacked).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.ie-card, .numpad-backdrop')) return;
      const all = document.querySelectorAll('.bb-scrim');
      if (all[all.length - 1] !== ref.current) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bb-scrim" ref={ref} onPointerDown={onClose}>
      <div
        className={`bb-dialog ${className ?? ''}`}
        role="dialog"
        aria-label={title}
        style={{ width }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="bb-dialog-head">
          <h2 className="bb-dialog-title">{title}</h2>
          {onClose && (
            <button type="button" className="bb-btn bb-btn--secondary" onClick={onClose}>
              <Icon name="close" />
              Zamknij
            </button>
          )}
        </div>
        <div className="bb-dialog-body">{children}</div>
        {footer && <div className="bb-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
