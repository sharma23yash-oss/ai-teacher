"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Plus,
  Send,
  X,
} from "lucide-react";
import type { ChatMessage, Language, RefinePromptResponseBody } from "@/lib/types";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";

const MIN_DRAFT_CHARS_TO_REFINE = 3;

// What the microphone is actually listening for. Hinglish is captured by the
// Hindi engine (see SPEECH_RECOGNITION_LOCALES), so say so rather than leaving
// the student wondering why their words come back in Devanagari.
const MIC_LANGUAGE_LABEL: Record<Language, string> = {
  english: "Indian English",
  hindi: "हिन्दी",
  hinglish: "Hinglish · हिन्दी engine",
};

// Shown on a fresh session, before the student has sent anything — one tap
// sends the pill's text as the first message, same as typing it in.
const STARTER_SUGGESTIONS = [
  "Meet the Creator: Who is Yash Sharma?",
  "Behind the Code: The sleepless nights & architecture",
  "Founder's Vision: Why Yash built this platform",
];

interface Quote {
  quote: string;
  author: string;
}

const DAILY_QUOTES: Quote[] = [
  {
    quote: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
    author: "Will Durant",
  },
  {
    quote: "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.",
    author: "Stephen King",
  },
  {
    quote: "The successful warrior is the average man, with laser-like focus.",
    author: "Bruce Lee",
  },
  {
    quote: "You do not rise to the level of your goals. You fall to the level of your systems.",
    author: "James Clear",
  },
  {
    quote:
      "Compound interest is the eighth wonder of the world. He who understands it, earns it; he who doesn't, pays it.",
    author: "Albert Einstein",
  },
];

export function ChatInterface({
  messages,
  onSend,
  isThinking,
  language,
  isTeacherSpeaking,
  onListeningChange,
  onUnlockAudio,
}: {
  messages: ChatMessage[];
  onSend: (content: string) => void;
  isThinking: boolean;
  language: Language;
  isTeacherSpeaking: boolean;
  onListeningChange: (isListening: boolean) => void;
  onUnlockAudio: () => void;
}) {
  const [draft, setDraft] = useState("");
  // Picked client-side, after mount, on purpose: a random pick made during SSR
  // wouldn't match the client's re-render, so the safe pattern is to start
  // null on both server and first client render and fill it in afterward.
  const [dailyQuote, setDailyQuote] = useState<Quote | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Text already in the input when the mic was activated, so live results
  // extend it instead of clobbering whatever the student had already typed.
  const baseTextRef = useRef("");

  const {
    isSupported: isMicSupported,
    isListening,
    isPaused,
    error: micError,
    start: startListening,
    stop: stopListening,
  } = useSpeechRecognition({
    language,
    // Hands-free mode leaves the mic open across turns, so without this the
    // recogniser transcribes the teacher's own voice out of the speakers and
    // feeds it straight back in as the student's next message.
    suspended: isTeacherSpeaking || isThinking,
    onInterimTranscript: (transcript) => {
      const base = baseTextRef.current;
      setDraft(base && transcript ? `${base} ${transcript}` : base + transcript);
    },
    onFinalTranscript: (transcript) => {
      const base = baseTextRef.current;
      const finalMessage = (base && transcript ? `${base} ${transcript}` : base + transcript).trim();
      baseTextRef.current = "";
      setDraft("");
      // Hands-free mode: the mic stays open across turns, so just send —
      // don't stop listening. useSpeechRecognition keeps the session alive
      // on its own even if the browser cuts it off mid-conversation.
      if (finalMessage) onSend(finalMessage);
    },
  });

  // Runs once, client-side only, after mount — see the dailyQuote state
  // comment for why this can't be picked during the initial render.
  useEffect(() => {
    // Deliberate: a random pick can never match between the server render
    // and the first client render, so setting it post-mount is the fix.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDailyQuote(DAILY_QUOTES[Math.floor(Math.random() * DAILY_QUOTES.length)]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // The avatar switches to its listening pose while the mic is live.
  useEffect(() => {
    onListeningChange(isListening);
  }, [isListening, onListeningChange]);

  // Closes the attach popover on an outside click, same as any standard menu.
  useEffect(() => {
    if (!isAttachMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setIsAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAttachMenuOpen]);

  // One object URL per image attachment, recreated only when the attachments
  // array itself changes — revoked on the next change (or unmount) so the
  // previous set never leaks.
  const attachmentPreviewUrls = useMemo(
    () =>
      attachments.map((file) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null)),
    [attachments],
  );
  useEffect(() => {
    return () => {
      attachmentPreviewUrls.forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, [attachmentPreviewUrls]);

  function handleMicToggle() {
    // The mic button is a user gesture, and it is very often the first one of
    // the session — unlock the audio graph here so the teacher's reply can be
    // spoken later without tripping the autoplay policy.
    onUnlockAudio();
    if (isListening || isPaused) {
      stopListening();
      return;
    }
    baseTextRef.current = draft.trim() ? `${draft.trim()} ` : "";
    startListening();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onUnlockAudio();
    const trimmed = draft.trim();
    if (!trimmed || isThinking) return;
    onSend(trimmed);
    setDraft("");
  }

  function handleSuggestionClick(suggestion: string) {
    // Same first-gesture audio-unlock as the send button and mic toggle —
    // a suggestion pill is very often the very first click of the session.
    onUnlockAudio();
    onSend(suggestion);
  }

  async function handleRefinePrompt() {
    const trimmed = draft.trim();
    if (trimmed.length < MIN_DRAFT_CHARS_TO_REFINE || isRefining || isThinking) return;

    setIsRefining(true);
    setRefineError(null);
    try {
      const res = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawPrompt: trimmed }),
      });
      const data = (await res.json()) as RefinePromptResponseBody;
      if (!data.ok) throw new Error(data.error);
      // Replaces the draft so the student can review the rewrite before
      // sending it — refining never sends on its own.
      setDraft(data.refinedPrompt);
    } catch (error) {
      setRefineError(
        error instanceof Error ? error.message : "Couldn't refine that prompt right now.",
      );
    } finally {
      setIsRefining(false);
    }
  }

  function handleFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      setAttachments((prev) => [...prev, ...Array.from(files)]);
    }
    // Lets the student pick the exact same file again later (a bare re-select
    // of an unchanged value doesn't fire onChange otherwise).
    e.target.value = "";
    setIsAttachMenuOpen(false);
  }

  function handleRemoveAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  const micIsActive = isListening || isPaused;
  const canRefine = draft.trim().length >= MIN_DRAFT_CHARS_TO_REFINE;
  const canSend = Boolean(draft.trim()) && !isThinking;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isThinking && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
            {dailyQuote && (
              <div className="max-w-md">
                <p className="font-serif text-xl italic leading-snug text-slate-400 md:text-2xl">
                  “{dailyQuote.quote}”
                </p>
                <p className="mt-2 text-sm font-bold tracking-wide text-indigo-500">
                  — {dailyQuote.author}
                </p>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "student" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                message.role === "student"
                  ? "rounded-br-sm bg-indigo-600 text-white"
                  : "rounded-bl-sm bg-slate-100 text-slate-800"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isThinking && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3">
        {isListening && (
          <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="flex items-end gap-0.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-0.5 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-red-500"
                  style={{ height: `${6 + (i % 3) * 4}px`, animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
            Listening in {MIC_LANGUAGE_LABEL[language]} (hands-free)
          </div>
        )}
        {isPaused && !isListening && (
          <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Mic paused while the teacher speaks — it resumes automatically.
          </div>
        )}
        {micError && !isListening && (
          <p className="mb-2 px-1 text-xs text-red-500">{micError}</p>
        )}
        {refineError && <p className="mb-2 px-1 text-xs text-red-500">{refineError}</p>}

        {canRefine && (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={handleRefinePrompt}
              disabled={isRefining || isThinking}
              className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-slate-600 backdrop-blur-md transition hover:border-white/30 hover:bg-white/20 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRefining ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Refining…
                </>
              ) : (
                <>✨ Refine Prompt</>
              )}
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file, index) => {
              const previewUrl = attachmentPreviewUrls[index];
              return (
                <div
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-1.5 pr-2 text-xs text-slate-700 transition-all"
                >
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={file.name}
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-200 text-slate-500">
                      <FileText size={16} />
                    </span>
                  )}
                  <span className="max-w-[9rem] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(index)}
                    aria-label={`Remove ${file.name}`}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-300 text-slate-600 transition hover:bg-slate-400 hover:text-slate-900"
                  >
                    <X size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div ref={attachMenuRef} className="relative shrink-0">
            {isAttachMenuOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-white/10 bg-[#111111]/90 p-1.5 shadow-2xl backdrop-blur-md transition-all">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition-all hover:bg-white/10"
                >
                  <Camera size={16} />
                  Camera
                </button>
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition-all hover:bg-white/10"
                >
                  <ImageIcon size={16} />
                  Photo / Gallery
                </button>
                <button
                  type="button"
                  onClick={() => documentInputRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-200 transition-all hover:bg-white/10"
                >
                  <FileText size={16} />
                  Document
                </button>
              </div>
            )}

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFilesSelected}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />
            <input
              ref={documentInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx"
              multiple
              className="hidden"
              onChange={handleFilesSelected}
            />

            <button
              type="button"
              onClick={() => setIsAttachMenuOpen((prev) => !prev)}
              aria-expanded={isAttachMenuOpen}
              title="Add an attachment"
              className={`flex h-10 w-10 items-center justify-center rounded-full transition-all ${
                isAttachMenuOpen
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              <Plus size={18} />
            </button>
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isThinking
                ? "Waiting for a response…"
                : isListening
                  ? "Listening…"
                  : "Answer the question, or ask for help..."
            }
            disabled={isThinking}
            className="flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleMicToggle}
            disabled={!isMicSupported}
            aria-pressed={micIsActive}
            title={
              !isMicSupported
                ? "Voice input isn't supported in this browser"
                : micIsActive
                  ? "Stop hands-free listening"
                  : `Start hands-free listening (${MIC_LANGUAGE_LABEL[language]})`
            }
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isListening
                ? "animate-pulse bg-red-600 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.25)]"
                : isPaused
                  ? "bg-amber-100 text-amber-600"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {isMicSupported ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            type="submit"
            aria-label="Send message"
            disabled={!canSend}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all ${
              canSend
                ? "bg-indigo-600 text-white shadow-md hover:bg-indigo-500"
                : "cursor-not-allowed bg-slate-200 text-slate-400"
            }`}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
