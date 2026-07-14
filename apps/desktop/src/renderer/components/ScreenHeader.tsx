import type { ReactNode } from "react";

/**
 * The standard screen header (established by the Command Deck redesign, now the
 * app-wide default): a small eyebrow kicker over the screen title, underlined by a
 * hairline, with an optional trailing slot for a live status badge. Every module
 * screen uses this so the app reads as one designed surface, not a set of pages.
 */
export function ScreenHeader({
  title,
  eyebrow = "Lodestar",
  trailing,
}: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly trailing?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex items-end justify-between gap-4 border-b border-white/10 pb-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-dim">{eyebrow}</p>
        <h1 className="mt-0.5 font-display text-xl uppercase tracking-[0.28em] text-orange">
          {title}
        </h1>
      </div>
      {trailing}
    </header>
  );
}
