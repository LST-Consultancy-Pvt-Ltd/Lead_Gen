'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

/**
 * Lead notes are stored in the existing `notes` string column so no DB change is needed.
 * Each entry is "<ISO date>|<author>|<text>" and entries are joined by NOTE_SEPARATOR.
 * Legacy notes (plain text with no header) are shown as a single entry with no date/author,
 * and are written back unchanged, so old values always remain intact.
 */
const NOTE_SEPARATOR = '\n\n---NOTE---\n\n';
const HEADER_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([^|\n]*)\|([\s\S]*)$/;

export interface LeadNote {
  date: string;   // ISO string, '' for legacy notes
  author: string; // '' for legacy notes
  text: string;
}

/** `fallback` is used only for display of header-less (legacy) entries, e.g. the lead's created date/user. */
export function parseNotes(raw?: string | null, fallback?: { date?: string; author?: string }): LeadNote[] {
  if (!raw || !raw.trim()) return [];
  return raw.split(NOTE_SEPARATOR).map((chunk) => {
    const m = chunk.match(HEADER_RE);
    return m
      ? { date: m[1], author: m[2], text: m[3] }
      : { date: fallback?.date || '', author: fallback?.author || '', text: chunk };
  });
}

export function serializeNotes(notes: LeadNote[]): string {
  return notes
    .filter((n) => n.text.trim())
    .map((n) => (n.date ? `${n.date}|${n.author.replace(/\|/g, '/')}|${n.text.trim()}` : n.text))
    .join(NOTE_SEPARATOR);
}

const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const TH = 'text-left py-2 px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider';

/** Read-only table of all notes. */
export function LeadNotesView({ value, fallback }: { value?: string | null; fallback?: { date?: string; author?: string } }) {
  const notes = parseNotes(value, fallback);
  if (notes.length === 0) return <p className="text-sm text-slate-500">—</p>;
  return <NotesGrid notes={notes} />;
}

function NoteRow({ index, note }: { index: number; note: LeadNote }) {
  return (
    <tr className="border-t border-slate-200 dark:border-white/[0.06] align-top">
      <td className="py-2 px-3 text-xs text-slate-500">{index}</td>
      <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(note.date)}</td>
      <td className="py-2 px-3 text-xs text-slate-500">{note.author || '—'}</td>
      <td className="py-2 px-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">{note.text}</td>
    </tr>
  );
}

function NotesGrid({ notes }: { notes: LeadNote[] }) {
  return (
    <div className="border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80">
            <tr>
              <th className={`${TH} w-8`}>#</th>
              <th className={`${TH} w-40`}>Date</th>
              <th className={`${TH} w-28`}>Added By</th>
              <th className={TH}>Note</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n, i) => (
              <NoteRow key={i} index={i + 1} note={n} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Edit mode: existing notes are shown read-only (never overwritten); "Add New Note"
 * adds an editable row. Every change reports the full serialized string via onChange,
 * so the parent form keeps sending a single `notes` field. Empty new lines are dropped.
 */
export function LeadNotesEditor({
  original, onChange, author, fallback,
}: { original?: string | null; onChange: (v: string) => void; author: string; fallback?: { date?: string; author?: string } }) {
  const existing = useMemo(() => parseNotes(original), [original]);
  const shown = useMemo(() => parseNotes(original, fallback), [original, fallback?.date, fallback?.author]);
  const [drafts, setDrafts] = useState<LeadNote[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const newNoteRef = useRef<HTMLTextAreaElement>(null);
  const prevDrafts = useRef(0);

  // When a note row is added, scroll the table to it and focus its textarea.
  useEffect(() => {
    if (drafts.length > prevDrafts.current) {
      const box = scrollRef.current;
      if (box) box.scrollTop = box.scrollHeight;
      newNoteRef.current?.focus({ preventScroll: true });
    }
    prevDrafts.current = drafts.length;
  }, [drafts.length]);

  const update = (next: LeadNote[]) => {
    setDrafts(next);
    onChange(serializeNotes([...existing, ...next]));
  };

  return (
    <div className="space-y-2">
      <div className="border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
        <div ref={scrollRef} className="max-h-56 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/80">
              <tr>
                <th className={`${TH} w-8`}>#</th>
                <th className={`${TH} w-40`}>Date</th>
                <th className={`${TH} w-28`}>Added By</th>
                <th className={TH}>Note</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((n, i) => (
                <NoteRow key={`e${i}`} index={i + 1} note={n} />
              ))}
              {drafts.map((n, i) => (
                <tr key={`d${i}`} className="border-t border-slate-200 dark:border-white/[0.06] align-top">
                  <td className="py-2 px-3 text-xs text-slate-500">{existing.length + i + 1}</td>
                  <td className="py-2 px-3 text-xs text-slate-500 whitespace-nowrap">{fmtDate(n.date)}</td>
                  <td className="py-2 px-3 text-xs text-slate-500">{n.author || '—'}</td>
                  <td className="py-1.5 px-3">
                    <textarea
                      ref={i === drafts.length - 1 ? newNoteRef : undefined}
                      className="input text-sm min-h-[56px] resize-y w-full"
                      placeholder="Type a new note..."
                      value={n.text}
                      onChange={(e) => update(drafts.map((d, j) => (j === i ? { ...d, text: e.target.value } : d)))}
                    />
                  </td>
                </tr>
              ))}
              {existing.length === 0 && drafts.length === 0 && (
                <tr><td colSpan={4} className="py-3 px-3 text-xs text-slate-500">No notes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <button
        type="button"
        onClick={() => update([...drafts, { date: new Date().toISOString(), author, text: '' }])}
        className="btn-ghost text-xs py-1 px-2 inline-flex items-center gap-1"
      >
        <Plus size={12} /> Add New Note
      </button>
    </div>
  );
}
