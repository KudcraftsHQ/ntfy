import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, ExternalLink, Mail, MailOpen, Trash2, X, Zap } from "lucide-react";
import { useState } from "react";
import { runAction, visibleActions } from "../lib/actions";
import { topicLabel } from "../lib/catalog";
import { deleteMessage, markRead, markUnread } from "../lib/db";
import { emojiTags, plainTags } from "../lib/emoji";
import { fullTime, priorityMeta } from "../lib/format";
import type { Action, AppView, StoredMessage, TopicView } from "../lib/types";
import { AttachmentView, MessageBody } from "./MessageBody";
import { PriorityPill } from "./MessageRow";
import { AppIcon, Button, cx, IconButton } from "./ui";

function ActionButton({ a }: { a: Action }) {
  const m = useMutation({ mutationFn: () => runAction(a) });
  return (
    <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending} title={m.error ? String(m.error.message) : a.url}>
      {a.action === "view" ? <ExternalLink className="size-3.5" /> : a.action === "copy" ? <Copy className="size-3.5" /> : <Zap className="size-3.5" />}
      {a.label}
      {m.isSuccess && !!m.data && <Check className="size-3.5 text-accent" />}
      {m.isError && <span className="text-urgent">failed</span>}
    </Button>
  );
}

export function MessageDetail({ m, app, topic, onClose }: { m: StoredMessage; app?: AppView; topic?: TopicView; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const emojis = emojiTags(m.tags).join(" ");
  const chips = plainTags(m.tags);
  // A "view" action pointing at the click URL would just duplicate the Open button.
  const actions = visibleActions(m.actions).filter((a) => !(a.action === "view" && a.url === m.click));
  const pm = priorityMeta(m.priority);

  const copy = async () => {
    await navigator.clipboard.writeText([m.title, m.message].filter(Boolean).join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <article className="flex h-full min-h-0 flex-col bg-panel" aria-label="Message">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3">
        <IconButton label="Back (Esc)" onClick={onClose} className="lg:hidden">
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="ml-1 flex min-w-0 items-center gap-2 text-[12.5px] text-ink-3">
          <AppIcon name={app?.name ?? m.topic} icon={app?.icon} size={18} />
          <span className="truncate font-medium text-ink-2">{app?.name ?? m.topic}</span>
          {app && topic && topicLabel(app, topic) && <span className="truncate">/ {topicLabel(app, topic)}</span>}
        </div>
        <div className="ml-auto flex items-center">
          {m.read ? (
            <IconButton label="Mark unread (U)" onClick={() => markUnread(m.id)}>
              <Mail className="size-4" />
            </IconButton>
          ) : (
            <IconButton label="Mark read" onClick={() => markRead([m.id])}>
              <MailOpen className="size-4" />
            </IconButton>
          )}
          <IconButton label="Copy text" onClick={copy}>
            {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
          </IconButton>
          <IconButton
            label="Delete from this device (#)"
            onClick={() => {
              void deleteMessage(m.id);
              onClose();
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>
          <IconButton label="Close (Esc)" onClick={onClose} className="hidden lg:inline-flex">
            <X className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="animate-in mx-auto max-w-2xl px-6 py-6">
          <div className="flex items-start gap-3.5">
            <AppIcon name={app?.name ?? m.topic} icon={m.icon || app?.icon} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <PriorityPill p={m.priority} />
                {pm.tone === "low" && <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">{pm.label} priority</span>}
              </div>
              <h2 className="mt-0.5 text-[19px] leading-snug font-semibold tracking-[-0.01em] text-ink">
                {emojis && <span className="mr-1.5">{emojis}</span>}
                {m.title || topic?.name || m.topic}
              </h2>
              <p className="mt-1 text-[12.5px] text-ink-3">{fullTime(m.time)}</p>
            </div>
          </div>

          <div className={cx("mt-5", !m.title && "text-[15px]")}>
            <MessageBody m={m} />
          </div>

          {m.attachment && (
            <div className="mt-5">
              <AttachmentView a={m.attachment} />
            </div>
          )}

          {(m.click || actions.length > 0) && (
            <div className="mt-6 flex flex-wrap gap-2">
              {m.click && (
                <Button variant="primary" size="sm" onClick={() => window.open(m.click, "_blank", "noopener,noreferrer")} title={m.click}>
                  <ExternalLink className="size-3.5" />
                  Open link
                </Button>
              )}
              {actions.map((a, i) => (
                <ActionButton key={a.id ?? i} a={a} />
              ))}
            </div>
          )}

          {chips.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-1.5">
              {chips.map((t) => (
                <span key={t} className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-3">
                  {t}
                </span>
              ))}
            </div>
          )}

          {m.click && <p className="mt-6 truncate text-[12px] text-ink-3">{m.click}</p>}
        </div>
      </div>
    </article>
  );
}
