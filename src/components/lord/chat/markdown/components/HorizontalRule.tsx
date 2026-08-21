/// <reference types="react/jsx-runtime" />
/** @jsxImportSource react */

"use client";

import { cn } from "@/lib/utils";

type HorizontalRuleProps = React.HTMLAttributes<HTMLHRElement>;

export function HorizontalRule({ className, ...props }: HorizontalRuleProps) {
  return (
    <hr className={cn("border-border/30 my-6", "dark:border-white/10", className)} {...props} />
  );
}
