"use client";

import { Highlight, themes } from "prism-react-renderer";

export function CodeStage({
  code,
  highlightLines,
  language = "python",
}: {
  code: string;
  highlightLines: number[];
  language?: string;
}) {
  const activeLine = highlightLines.at(-1);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
      <Highlight theme={themes.vsDark} code={code.trim()} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={`${className} w-full max-w-2xl overflow-x-auto rounded-xl border border-white/10 p-4 text-sm leading-relaxed shadow-2xl`}
            style={{ ...style, backgroundColor: "#1e1e1e" }}
          >
            {tokens.map((line, i) => {
              const lineNumber = i + 1;
              const isHighlighted = highlightLines.includes(lineNumber);
              const isActive = lineNumber === activeLine;
              const { className: lineClassName, ...lineProps } = getLineProps({ line });

              return (
                <div
                  key={i}
                  {...lineProps}
                  className={`${lineClassName} flex px-2 -mx-2 rounded transition-colors ${
                    isHighlighted ? "bg-indigo-500/15" : ""
                  }`}
                >
                  <span
                    className="mr-1 w-4 shrink-0 animate-pulse text-indigo-400"
                    aria-hidden
                  >
                    {isActive ? "▶" : ""}
                  </span>
                  <span className="mr-4 w-6 shrink-0 select-none text-right text-slate-600">
                    {lineNumber}
                  </span>
                  <span>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </span>
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
}
