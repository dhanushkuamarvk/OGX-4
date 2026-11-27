"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";

function renderInline(text: string): React.ReactNode[] {
  // Parse **bold** and `code` safely without innerHTML
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-cyan-200"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{tok}</React.Fragment>;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function MarkdownMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="border-white/10 my-2.5" />);
      i++;
      continue;
    }

    // Markdown table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = parseTableRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div
          key={`tbl-${i}`}
          className="overflow-x-auto my-2 rounded-lg border border-white/10 bg-black/30"
        >
          <table className="w-full text-[11px] text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.04] text-zinc-200">
                {headers.map((h, hi) => (
                  <th key={hi} className="px-2.5 py-1.5 font-semibold whitespace-nowrap">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 text-zinc-300">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4 key={`h3-${i}`} className="text-xs font-semibold text-violet-300 mt-2.5 mb-1">
          {renderInline(trimmed.slice(4))}
        </h4>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h3 key={`h2-${i}`} className="text-sm font-semibold text-cyan-200 mt-3 mb-1">
          {renderInline(trimmed.slice(3))}
        </h3>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push(
        <h2 key={`h1-${i}`} className="text-base font-bold text-white mt-1 mb-2">
          {renderInline(trimmed.slice(2))}
        </h2>
      );
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      blocks.push(
        <blockquote
          key={`bq-${i}`}
          className="border-l-2 border-violet-400/60 bg-violet-500/10 pl-3 pr-2 py-1.5 my-1.5 rounded-r-md text-violet-100"
        >
          {renderInline(trimmed.slice(2))}
        </blockquote>
      );
      i++;
      continue;
    }

    // Bullet list
    if (/^[-•*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc pl-4 space-y-1 my-1.5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal pl-4 space-y-1 my-1.5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Italicized footnote line (*...*)
    if (trimmed.startsWith("*") && trimmed.endsWith("*") && !trimmed.startsWith("**") && trimmed.length > 2) {
      blocks.push(
        <p key={`em-${i}`} className="text-[11px] italic text-zinc-400 mt-1">
          {trimmed.slice(1, -1)}
        </p>
      );
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push(
      <p key={`p-${i}`} className="leading-relaxed">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return <div className={cn("space-y-1.5 text-xs", className)}>{blocks}</div>;
}
