"use client";

import type { TextareaHTMLAttributes } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";

type AutoSizeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  value: string;
};

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AutoSizeTextarea({
  value,
  className,
  style,
  onInput,
  ...rest
}: AutoSizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const mergedClassName = useMemo(() => {
    const parts = ["autosize-textarea", className].filter(Boolean);
    return parts.join(" ");
  }, [className]);

  const resize = () => {
    const el = ref.current;
    if (!el) return;

    const computed = window.getComputedStyle(el);
    const borderTop = parsePx(computed.borderTopWidth);
    const borderBottom = parsePx(computed.borderBottomWidth);

    el.style.height = "0px";
    el.style.height = `${el.scrollHeight + borderTop + borderBottom}px`;
  };

  useLayoutEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      value={value}
      className={mergedClassName}
      style={style}
      onInput={(event) => {
        onInput?.(event);
        resize();
      }}
    />
  );
}
