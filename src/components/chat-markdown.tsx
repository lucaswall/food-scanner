"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMarkdownProps {
  content: string;
}

const HEADING_ELEMENTS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="text-sm space-y-1 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_p]:my-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={[...HEADING_ELEMENTS]}
        unwrapDisallowed
        components={{
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
