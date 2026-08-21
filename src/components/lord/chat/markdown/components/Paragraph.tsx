/// <reference types="react/jsx-runtime" />
/** @jsxImportSource react */

/** @jsxImportSource react */

"use client";

import { cn } from "@/lib/utils";

type ParagraphProps = React.HTMLAttributes<HTMLParagraphElement>;

export function Paragraph({ children, className, ...props }: ParagraphProps) {
  return (
    <p className={cn("leading-relaxed text-foreground/90 mb-4", className)} {...props}>
      {children}
    </p>
  );
}
