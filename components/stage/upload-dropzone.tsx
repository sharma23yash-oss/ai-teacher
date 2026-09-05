"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";

const ACCEPTED_TYPES = ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";

export function UploadDropzone({
  uploadedFileName,
  isUploading,
  uploadError,
  onUpload,
  onClearUpload,
}: {
  uploadedFileName: string | null;
  isUploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onClearUpload: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onUpload(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-xs transition ${
        isDragging
          ? "border-indigo-400 bg-indigo-500/10"
          : "border-white/15 bg-white/5"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {isUploading ? (
        <span className="flex items-center gap-1.5 text-slate-400">
          <Loader2 size={13} className="animate-spin" />
          Reading file…
        </span>
      ) : uploadedFileName ? (
        <span className="flex items-center gap-1.5 text-indigo-300">
          <FileText size={13} />
          <span className="max-w-[10rem] truncate">{uploadedFileName}</span>
          <button
            onClick={onClearUpload}
            aria-label="Remove uploaded file"
            className="text-slate-500 transition hover:text-slate-300"
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 text-slate-400 transition hover:text-slate-200"
        >
          <Paperclip size={13} />
          Upload PDF or notes
        </button>
      )}

      {uploadError && (
        <span className="truncate text-red-400" title={uploadError}>
          {uploadError}
        </span>
      )}
    </div>
  );
}
