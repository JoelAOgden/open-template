import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { Textarea } from "../../components/ui/Fields";
import { assetUrl } from "../../lib/api";
export function Asset({ id, alt }: { id: string; alt: string; }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true,
      current = "";
    assetUrl(id)
      .then((u) => {
        current = u;
        if (active) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => { });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [id]);
  return url ? (
    <img src={url} alt={alt} />
  ) : (
    <div className="image-placeholder">Loading image…</div>
  );
}
export function WritingArea({
  value,
  onChange,
  placeholder,
  label,
  className = "",
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      if (!width) return;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);
  return (
    <Textarea
      ref={ref}
      aria-label={label}
      className={`writing-area ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      style={style}
    />
  );
}
