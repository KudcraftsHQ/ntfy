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
  // A hairline-outlined status badge, like a "Failed" transaction label.
  return (
    <span
      className={cx(
        "inline-flex h-[20px] shrink-0 items-center rounded-[6px] border px-1.5 text-[11.5px] font-medium",
        meta.tone === "urgent" ? "border-urgent/35 bg-urgent-soft text-urgent" : "border-high/30 bg-high-soft text-high",
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
  const source = app ? (label ? `${app.name} / ${label}` : app.name) : m.topic;
  const meta = (
    <span className="ml-auto flex shrink-0 items-center gap-2 self-start pt-px">
      {m.attachment && <Paperclip className="size-3 text-ink-3" aria-label="Attachment" />}
      <time className={cx("text-[12.5px] tabular-nums", unread ? "text-ink" : "text-ink-3")} dateTime={new Date(m.time * 1000).toISOString()}>
        {relativeTime(m.time)}
      </time>
      <span aria-label={unread ? "Unread" : undefined} className={cx("size-[7px] rounded-full", unread ? "bg-unread" : "bg-transparent")} />
    </span>
  );

  return (
    <button
      id={`msg-${m.id}`}
      data-selected={selected || undefined}
      onClick={() => onSelect(m.id)}
      className={cx(
        "group relative flex w-full gap-3.5 border-b border-line px-5 py-3 text-left transition-colors duration-150 md:px-7",
        selected ? "bg-hover" : "hover:bg-hover/70",
      )}
    >
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
      <div className="relative pt-0.5">
        <AppIcon name={app?.name ?? m.topic} icon={m.icon || app?.icon} size={34} />
      </div>
      <div className="min-w-0 flex-1">
        {showSource && (
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] text-ink-3">{source}</span>
            {meta}
          </div>
        )}
        <div className={cx("flex items-center gap-2", showSource && "mt-0.5")}>
          <h3 className={cx("min-w-0 text-[15px] leading-snug tracking-[-0.005em]", m.title ? "truncate" : "line-clamp-2", unread ? "font-medium text-ink" : "text-ink-2")}>
            {emojis && <span className="mr-1">{emojis}</span>}
            {title}
          </h3>
          <PriorityPill p={p} />
          {!showSource && meta}
        </div>
        {preview && <p className="mt-1 line-clamp-2 text-[13.5px] leading-[1.5] text-ink-3">{preview}</p>}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {chips.map((t) => (
              <span key={t} className="rounded-[6px] border border-line px-1.5 py-px text-[11.5px] text-ink-3">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
});
