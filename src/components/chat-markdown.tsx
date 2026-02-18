"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMarkdownProps {
  content: string;
}

const HEADING_ELEMENTS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="text-sm space-y-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-0.5 [&_p]:my-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={[...HEADING_ELEMENTS]}
        unwrapDisallowed
        components={{
          img: () => null,
          a: ({ href, children }) => {
            const safeHref = href && /^(https?:|mailto:)/i.test(href) ? href : undefined;
            return <a href={safeHref} rel="noopener noreferrer">{children}</a>;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-1.5 py-1 text-left text-xs">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-1.5 py-1 text-xs">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
