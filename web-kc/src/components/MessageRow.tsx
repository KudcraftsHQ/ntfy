import { Paperclip } from "lucide-react";
import { memo } from "react";
import { emojiTags, plainTags } from "../lib/emoji";
import { previewText, priorityMeta, relativeTime } from "../lib/format";
import { topicLabel } from "../lib/catalog";
import type { AppView, StoredMessage, TopicView } from "../lib/types";
import { AppIcon, cx } from "./ui";

export const PriorityPill = ({ p }: { p?: number }) => {
  const meta = priorityMeta(p);
  if (meta.tone !== "urgent" && meta.tone !== "high") return null;
  return (
    <span
      className={cx(
        "inline-flex h-[18px] shrink-0 items-center rounded-md px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]",
        meta.tone === "urgent" ? "bg-urgent-soft text-urgent" : "bg-high-soft text-high",
      )}
    >
      {meta.label}
    </span>
  );
};

interface Props {
  m: StoredMessage;
  app?: AppView;
  topic?: TopicView;
  showSource: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

export const MessageRow = memo(function MessageRow({ m, app, topic, showSource, selected, onSelect }: Props) {
  const emojis = emojiTags(m.tags).join(" ");
  const chips = plainTags(m.tags).slice(0, 3);
  const text = previewText(m.message, m.content_type === "text/markdown");
  // Untitled messages lead with their text, like a chat line.
  const title = m.title || text || (topic ? topic.name : m.topic);
  const preview = m.title ? text : "";
  const p = m.priority ?? 3;
  const unread = m.read === 0;
  const label = app && topic ? topicLabel(app, topic) : null;
  const source = app ? (label ? `${app.name} · ${label}` : app.name) : m.topic;
  const meta = (
    <span className="ml-auto flex shrink-0 items-center gap-2 self-start pt-px">
      {m.attachment && <Paperclip className="size-3 text-ink-3" aria-label="Attachment" />}
      <time className={cx("text-[12px] tabular-nums", unread ? "font-medium text-ink-2" : "text-ink-3")} dateTime={new Date(m.time * 1000).toISOString()}>
        {relativeTime(m.time)}
      </time>
      <span aria-label={unread ? "Unread" : undefined} className={cx("size-2 rounded-full", unread ? "bg-unread" : "bg-transparent")} />
    </span>
  );

  return (
    <button
      id={`msg-${m.id}`}
      data-selected={selected || undefined}
      onClick={() => onSelect(m.id)}
      className={cx(
        "group relative flex w-full gap-3 rounded-xl px-3 py-3 text-left transition-colors",
        selected ? "bg-active" : "hover:bg-hover",
      )}
    >
      {p >= 4 && <span aria-hidden className={cx("absolute top-3 bottom-3 left-0 w-[3px] rounded-full", p >= 5 ? "bg-urgent" : "bg-high")} />}
      <div className="relative">
        <AppIcon name={app?.name ?? m.topic} icon={m.icon || app?.icon} size={36} />
      </div>
      <div className="min-w-0 flex-1">
        {showSource && (
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium text-ink-3">{source}</span>
            {meta}
          </div>
        )}
        <div className={cx("flex items-center gap-2", showSource && "mt-0.5")}>
          <h3 className={cx("min-w-0 text-[14px] leading-snug", m.title ? "truncate" : "line-clamp-2", unread ? "font-semibold text-ink" : "font-medium text-ink-2")}>
            {emojis && <span className="mr-1">{emojis}</span>}
            {title}
          </h3>
          <PriorityPill p={p} />
          {!showSource && meta}
        </div>
        {preview && <p className="mt-0.5 line-clamp-2 text-[13px] leading-[1.45] text-ink-3">{preview}</p>}
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((t) => (
              <span key={t} className="rounded-md bg-hover px-1.5 py-px text-[11px] text-ink-3 group-hover:bg-active">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
});
