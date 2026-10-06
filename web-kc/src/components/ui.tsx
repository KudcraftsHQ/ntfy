import clsx from "clsx";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { hueFor } from "../lib/format";
import { safeHttpUrl } from "../lib/url";

export const cx = clsx;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]",
        variant === "primary" && "bg-accent text-white hover:brightness-110 dark:text-[#06231d] shadow-sm",
        variant === "secondary" && "bg-raised text-ink border border-line hover:bg-hover shadow-[0_1px_0_rgba(0,0,0,0.02)]",
        variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
        variant === "danger" && "text-urgent hover:bg-urgent-soft",
        className,
      )}
    />
  );
}

export function IconButton({ label, className, children, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-8 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-hover hover:text-ink",
        active && "bg-hover text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-raised px-1 font-sans text-[11px] font-medium text-ink-3">
      {children}
    </kbd>
  );
}

/** App icon: the catalog/message icon, or a tinted letter tile. */
export function AppIcon({ name, icon, size = 32, className }: { name: string; icon?: string; size?: number; className?: string }) {
  const radius = size >= 28 ? "rounded-[9px]" : "rounded-md";
  const [failed, setFailed] = useState<string | null>(null);
  const src = safeHttpUrl(icon);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={cx("shrink-0 object-cover bg-hover ring-1 ring-black/5 dark:ring-white/10", radius, className)}
        style={{ width: size, height: size }}
        onError={() => setFailed(src)}
      />
    );
  }
  const h = hueFor(name);
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center font-semibold text-white", radius, className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
        background: `linear-gradient(135deg, oklch(0.68 0.13 ${h}), oklch(0.56 0.14 ${(h + 30) % 360}))`,
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} aria-label="Loading" />;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cx("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function Dialog({ open, onClose, children, className, label }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-[2px] dark:bg-black/60" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={label}
        aria-modal
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className={cx("animate-in w-full max-w-lg overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/20", className)}
      >
        {children}
      </div>
    </div>
  );
}
