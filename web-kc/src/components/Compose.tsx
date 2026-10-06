import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { publish } from "../lib/api";
import { allTopics } from "../lib/catalog";
import type { AppView } from "../lib/types";
import { useUi } from "../store/ui";
import { Button, cx, Dialog, Kbd, Spinner, Switch } from "./ui";

const priorities = [
  { v: 1, label: "Min" },
  { v: 2, label: "Low" },
  { v: 3, label: "Normal" },
  { v: 4, label: "High" },
  { v: 5, label: "Urgent" },
];

export function Compose({ apps, defaultTopic }: { apps: AppView[]; defaultTopic?: string }) {
  const open = useUi((s) => s.composeOpen);
  const set = useUi((s) => s.set);
  if (!open) return null;
  // Mounted only while open, so the form starts fresh each time.
  return <ComposeForm apps={apps} defaultTopic={defaultTopic} onClose={() => set({ composeOpen: false })} />;
}

function ComposeForm({ apps, defaultTopic, onClose }: { apps: AppView[]; defaultTopic?: string; onClose: () => void }) {
  const writable = allTopics(apps).filter((t) => t.writable);
  const [topic, setTopic] = useState(defaultTopic && writable.some((t) => t.topic === defaultTopic) ? defaultTopic : (writable[0]?.topic ?? ""));
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState(3);
  const [tags, setTags] = useState("");
  const [click, setClick] = useState("");
  const [markdown, setMarkdown] = useState(false);
  const m = useMutation({
    mutationFn: () =>
      publish({
        topic,
        title: title.trim() || undefined,
        message,
        priority: priority === 3 ? undefined : priority,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        click: click.trim() || undefined,
        markdown: markdown || undefined,
      }),
    onSuccess: onClose,
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (topic && message.trim() && !m.isPending) m.mutate();
  };

  const field = "h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[13.5px] outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/15";

  return (
    <Dialog open onClose={onClose} label="New message" className="max-w-xl">
      <form onSubmit={submit} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[14px] font-semibold">New message</h2>
          <Kbd>Esc</Kbd>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-3">
            <label htmlFor="c-topic" className="text-[12.5px] text-ink-3">
              Topic
            </label>
            <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value)} className={field}>
              {writable.length === 0 && <option value="">No topics you can publish to</option>}
              {apps.map((a) => {
                const ts = a.topics.filter((t) => t.writable);
                return ts.length ? (
                  <optgroup key={a.id} label={a.name}>
                    {ts.map((t) => (
                      <option key={t.topic} value={t.topic}>
                        {t.topic}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
            <label htmlFor="c-title" className="text-[12.5px] text-ink-3">
              Title
            </label>
            <input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" className={field} />
          </div>
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write a message…"
            aria-label="Message"
            rows={5}
            className={cx(field, "h-auto resize-y py-2.5 leading-relaxed")}
          />
          <div>
            <div className="mb-1.5 text-[12.5px] text-ink-3">Priority</div>
            <div className="grid grid-cols-5 gap-1 rounded-lg bg-hover p-1">
              {priorities.map((p) => (
                <button
                  type="button"
                  key={p.v}
                  onClick={() => setPriority(p.v)}
                  className={cx(
                    "h-7 rounded-md text-[12.5px] font-medium transition",
                    priority === p.v ? "bg-panel text-ink shadow-sm" : "text-ink-3 hover:text-ink",
                    priority === p.v && p.v === 5 && "text-urgent",
                    priority === p.v && p.v === 4 && "text-high",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" aria-label="Tags" className={field} />
            <input value={click} onChange={(e) => setClick(e.target.value)} placeholder="Click URL" aria-label="Click URL" className={field} />
          </div>
          <label className="flex items-center gap-2.5 text-[13px] text-ink-2">
            <Switch checked={markdown} onChange={setMarkdown} label="Markdown" />
            Format as Markdown
          </label>
          {m.error && <p className="rounded-lg bg-urgent-soft px-3 py-2 text-[12.5px] text-urgent">{m.error.message}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-sidebar px-5 py-3">
          <span className="mr-auto hidden items-center gap-1 text-[12px] text-ink-3 sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd> to send
          </span>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!topic || !message.trim() || m.isPending}>
            {m.isPending ? <Spinner /> : <Send className="size-3.5" />}
            Send
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
