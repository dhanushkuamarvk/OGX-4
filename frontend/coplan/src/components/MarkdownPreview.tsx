import React from "react";

interface MarkdownPreviewProps {
  content: string;
}

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-indigo-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return (
        <em key={i} className="italic text-slate-600">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  // Strip internal section HTML comment markers in human preview mode
  const cleaned = content.replace(/<!--\s*coplan:step:[^>]+-->/g, "").trim();

  if (!cleaned) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">
        Artifact is empty. As the agent completes steps—or as you type—the shared Markdown document updates live here.
      </div>
    );
  }

  const lines = cleaned.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: { indent: number; text: string }[] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`${keyPrefix}-ul`} className="my-2 space-y-1.5 pl-4">
        {listItems.map((item, idx) => (
          <li
            key={idx}
            className="list-disc text-sm leading-relaxed text-slate-700"
            style={{ marginLeft: item.indent > 0 ? 16 : 0 }}
          >
            {renderInline(item.text)}
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList(`l-${idx}`);
      return;
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch) {
      listItems.push({ indent: bulletMatch[1].length, text: bulletMatch[2] });
      return;
    }

    flushList(`b-${idx}`);

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3 key={idx} className="mt-4 mb-1.5 text-sm font-semibold uppercase tracking-wide text-slate-700">
          {renderInline(trimmed.slice(4))}
        </h3>,
      );
    } else if (trimmed.startsWith("## ")) {
      blocks.push(
        <h2 key={idx} className="mt-6 mb-2 border-b border-slate-200 pb-1 text-lg font-semibold text-slate-900">
          {renderInline(trimmed.slice(3))}
        </h2>,
      );
    } else if (trimmed.startsWith("# ")) {
      blocks.push(
        <h1 key={idx} className="mb-3 text-2xl font-bold tracking-tight text-slate-900">
          {renderInline(trimmed.slice(2))}
        </h1>,
      );
    } else {
      blocks.push(
        <p key={idx} className="my-2 text-sm leading-relaxed text-slate-700">
          {renderInline(trimmed)}
        </p>,
      );
    }
  });
  flushList("end");

  return <div className="prose-coplan max-w-none">{blocks}</div>;
};
