import { useRef, useState, type HTMLAttributes } from "react";

export function FileDrop({
  onFiles,
  onError,
  disabled = false,
  className = "",
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "onError"> & {
  onFiles: (files: File[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  return (
    <div
      {...props}
      className={`${className}${over && !disabled ? " file-drop-active" : ""}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        if (
          Array.from(event.dataTransfer.items).some(
            (item) => item.webkitGetAsEntry?.()?.isDirectory,
          )
        ) {
          onError("Import files, not folders.");
          return;
        }
        onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
    </div>
  );
}
