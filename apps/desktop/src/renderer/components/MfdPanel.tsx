import type { ReactNode } from "react";

export interface MfdPanelProps {
  readonly title?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The base panel: a frosted-glass surface with an optional titled header.
 * Rendered as an accessible region labelled by its title.
 */
export function MfdPanel({ title, className, children }: MfdPanelProps): React.JSX.Element {
  return (
    <section
      aria-label={title}
      className={`glass rounded-xl text-orange transition-shadow duration-200 hover:shadow-glow ${className ?? ""}`}
    >
      {title !== undefined && (
        <header className="border-b border-white/10 px-3.5 py-2">
          <h2 className="font-display text-[11px] uppercase tracking-[0.22em] text-cyan/90">
            {title}
          </h2>
        </header>
      )}
      <div className="p-3.5">{children}</div>
    </section>
  );
}
