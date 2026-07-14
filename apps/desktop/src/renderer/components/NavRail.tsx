import { MODULES } from "../modules.js";
import type { ModuleId } from "../modules.js";
import logoUrl from "../assets/polaris-logo-horizontal.svg";

export interface NavRailProps {
  readonly active: ModuleId;
  readonly onSelect: (id: ModuleId) => void;
}

/**
 * The nav rail (Step 0.9 / brand pass). The Polaris lockup sits at the top;
 * available modules navigate, unbuilt ones show their arrival phase and are
 * inert (never dead links). A frosted-glass column over the deep backdrop.
 */
export function NavRail({ active, onSelect }: NavRailProps): React.JSX.Element {
  return (
    <nav
      aria-label="Modules"
      className="flex w-52 flex-col gap-1.5 border-r border-white/10 bg-white/[0.02] p-3 backdrop-blur-md"
    >
      <div className="mb-3 px-1 pt-1">
        <img
          src={logoUrl}
          alt="Polaris"
          className="h-8 w-auto select-none opacity-95 drop-shadow-[0_0_10px_rgba(245,113,27,0.25)]"
          draggable={false}
        />
      </div>
      {MODULES.map((module) => {
        const isActive = module.id === active;
        return (
          <button
            key={module.id}
            type="button"
            disabled={!module.available}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              if (module.available) onSelect(module.id);
            }}
            className={`flex flex-col rounded-lg border px-3 py-2 text-left font-display text-[11px] uppercase tracking-[0.15em] transition-all duration-150 ${
              isActive
                ? "border-orange/60 bg-orange/15 text-orange shadow-glow"
                : module.available
                  ? "border-white/5 text-cyan/80 hover:border-cyan/30 hover:bg-cyan/10 hover:text-cyan"
                  : "border-transparent text-signal-skip"
            }`}
          >
            <span>{module.label}</span>
            {!module.available && (
              <span className="mt-0.5 text-[9px] normal-case tracking-normal text-signal-skip">
                arrives · Phase {module.phase}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
