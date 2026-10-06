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
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[background-color,color,box-shadow,filter] duration-150 ease-calm disabled:opacity-45 disabled:pointer-events-none select-none whitespace-nowrap",
        size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-9 px-4 text-[14px]",
        variant === "primary" && "bg-accent text-on-accent shadow-[0_1px_0_rgb(255_255_255/0.15)_inset,0_1px_2px_rgb(30_40_120/0.25)] hover:brightness-[1.06]",
        variant === "secondary" && "bg-pill text-ink hover:bg-active",
        variant === "outline" && "border border-line-strong bg-raised text-ink hover:bg-hover",
        variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
        variant === "danger" && "bg-pill text-urgent hover:bg-urgent-soft",
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
        "inline-flex size-8 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink [&_svg]:stroke-[1.6]",
        active && "bg-active text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-canvas px-1 font-sans text-[11px] font-medium text-ink-3">
      {children}
    </kbd>
  );
}

/** App icon: the catalog/message icon, or a tinted letter tile. */
export function AppIcon({ name, icon, size = 32, className }: { name: string; icon?: string; size?: number; className?: string }) {
  // Round, like account avatars: logos get a hairline ring, letters a soft tint.
  const radius = "rounded-full";
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
        className={cx("shrink-0 bg-white object-cover ring-1 ring-line", radius, className)}
        style={{ width: size, height: size }}
        onError={() => setFailed(src)}
      />
    );
  }
  const h = hueFor(name);
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center font-semibold tracking-tight", radius, className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `light-dark(oklch(0.94 0.035 ${h}), oklch(0.32 0.05 ${h}))`,
        color: `light-dark(oklch(0.42 0.09 ${h}), oklch(0.86 0.06 ${h}))`,
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
      className={cx("relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-200 ease-calm", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cx("inline-block size-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-calm", checked ? "translate-x-[18px]" : "translate-x-[2px]")} />
    </button>
  );
}

export function Dialog({ open, onClose, children, className, label }: { open: boolean; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgb(20_20_35/0.28)] p-4 pt-[12vh] dark:bg-black/60" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={label}
        aria-modal
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className={cx("animate-in w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-panel shadow-float", className)}
      >
        {children}
      </div>
    </div>
  );
}
