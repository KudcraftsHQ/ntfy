import { File, Download } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatBytes } from "../lib/format";
import { safeHttpUrl, safeUrl } from "../lib/url";
import type { Attachment, NtfyMessage } from "../lib/types";

const urlRe = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function Linkified({ text }: { text: string }) {
  const parts = text.split(urlRe);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

export const isMarkdown = (m: NtfyMessage) => m.content_type === "text/markdown";

export function MessageBody({ m }: { m: NtfyMessage }) {
  if (!m.message) return null;
  if (isMarkdown(m)) {
    return (
      <div className="md">
        <Markdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url, key) => (key === "src" ? safeHttpUrl(url) : safeUrl(url)) ?? ""}
          components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" /> }}
        >
          {m.message}
        </Markdown>
      </div>
    );
  }
  return (
    <div className="md whitespace-pre-wrap">
      <Linkified text={m.message} />
    </div>
  );
}

const isImage = (a: Attachment) => (a.type ? a.type.startsWith("image/") : /\.(png|jpe?g|gif|webp)$/i.test(a.name || a.url));

export function AttachmentView({ a, compact }: { a: Attachment; compact?: boolean }) {
  const url = safeHttpUrl(a.url);
  const expired = !url || (!!a.expires && a.expires * 1000 < Date.now());
  if (isImage(a) && !expired && !compact) {
    return (
      <a href={url ?? undefined} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-xl border border-line bg-hover">
        <img src={url ?? undefined} alt={a.name} loading="lazy" className="max-h-[420px] w-full object-contain" />
      </a>
    );
  }
  return (
    <a
      href={expired ? undefined : (url ?? undefined)}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-full items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] transition hover:border-line-strong"
    >
      <File className="size-4 shrink-0 text-ink-3" />
      <span className="truncate font-medium text-ink">{a.name}</span>
      <span className="shrink-0 text-ink-3">{!url ? "unavailable" : expired ? "expired" : formatBytes(a.size)}</span>
      {!expired && <Download className="size-3.5 shrink-0 text-ink-3" />}
    </a>
  );
}
