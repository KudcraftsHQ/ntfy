import { useUi } from "../store/ui";
import { Dialog, Kbd } from "./ui";

export const shortcuts: [string[], string][] = [
  [["⌘", "K"], "Jump to app or topic"],
  [["J"], "Next message"],
  [["K"], "Previous message"],
  [["O"], "Open message link"],
  [["U"], "Toggle read / unread"],
  [["⇧", "R"], "Mark all read"],
  [["M"], "Mute app or topic"],
  [["/"], "Search"],
  [["C"], "New message"],
  [["G", "A"], "Go to all messages"],
  [["G", "S"], "Go to settings"],
  [["Esc"], "Close / back"],
  [["?"], "This list"],
];

export function ShortcutList() {
  return (
    <ul className="divide-y divide-line">
      {shortcuts.map(([keys, label]) => (
        <li key={label} className="flex items-center justify-between py-2 text-[13px] text-ink-2">
          {label}
          <span className="flex gap-1">
            {keys.map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen);
  const set = useUi((s) => s.set);
  return (
    <Dialog open={open} onClose={() => set({ helpOpen: false })} label="Keyboard shortcuts" className="max-w-sm">
      <div className="border-b border-line px-5 py-3.5 text-[14px] font-semibold">Keyboard shortcuts</div>
      <div className="px-5 py-2">
        <ShortcutList />
      </div>
    </Dialog>
  );
}
