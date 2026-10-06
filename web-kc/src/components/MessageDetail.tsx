import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, ExternalLink, Mail, MailOpen, Trash2, X, Zap } from "lucide-react";
import { useState } from "react";
import { runAction, visibleActions } from "../lib/actions";
import { openSafe, safeUrl } from "../lib/url";
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
    <Button onClick={() => m.mutate()} disabled={m.isPending} title={m.error ? String(m.error.message) : a.url}>
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
  const click = safeUrl(m.click);
  // A "view" action pointing at the click URL would just duplicate the Open button.
  const actions = visibleActions(m.actions).filter((a) => !(a.action === "view" && safeUrl(a.url) === click));
  const pm = priorityMeta(m.priority);

  const copy = async () => {
    await navigator.clipboard.writeText([m.title, m.message].filter(Boolean).join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <article className="flex h-full min-h-0 flex-col bg-panel" aria-label="Message">
      <header className="flex h-16 shrink-0 items-center gap-1 border-b border-line px-3 md:px-5">
        <span className="contents lg:hidden">
          <IconButton label="Back (Esc)" onClick={onClose}>
            <ArrowLeft className="size-4" />
          </IconButton>
        </span>
        <div className="ml-1 flex min-w-0 items-center gap-2 text-[13.5px] text-ink-3">
          <AppIcon name={app?.name ?? m.topic} icon={app?.icon} size={20} />
          <span className="truncate text-ink-2">{app?.name ?? m.topic}</span>
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
          <span className="hidden lg:contents">
            <IconButton label="Close (Esc)" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="animate-in mx-auto max-w-2xl px-6 py-8 md:px-8">
          <AppIcon name={app?.name ?? m.topic} icon={m.icon || app?.icon} size={44} />
          <h2 className="mt-5 text-[26px] leading-[1.2] font-normal tracking-[-0.02em] text-ink">
            {emojis && <span className="mr-2">{emojis}</span>}
            {m.title || topic?.name || m.topic}
          </h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-3">
            <span className="tabular-nums">{fullTime(m.time)}</span>
            {(pm.tone === "urgent" || pm.tone === "high") && <PriorityPill p={m.priority} />}
            {pm.tone === "low" && <span>· {pm.label} priority</span>}
          </div>

          <div className={cx("mt-6 border-t border-line pt-6", !m.title && "text-[15px]")}>
            <MessageBody m={m} />
          </div>

          {m.attachment && (
            <div className="mt-5">
              <AttachmentView a={m.attachment} />
            </div>
          )}

          {(click || actions.length > 0) && (
            <div className="mt-6 flex flex-wrap gap-2">
              {click && (
                <Button variant="primary" onClick={() => openSafe(click)} title={click}>
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
                <span key={t} className="rounded-[6px] border border-line px-2 py-0.5 text-[12px] text-ink-3">
                  {t}
                </span>
              ))}
            </div>
          )}

          {click && <p className="mt-6 truncate border-t border-line pt-4 text-[12.5px] text-ink-3">{click}</p>}
        </div>
      </div>
    </article>
  );
}
