"use client";

import { useState } from "react";
import { Button, Select, Textarea } from "./ui";

export interface StageOption {
  key: string;
  label: string;
  kind: string;
}

export const LOST_REASON_LABELS = {
  te_duur: "Te duur",
  geen_reactie: "Geen reactie",
  concurrent: "Concurrent",
  anders: "Anders",
} as const;
export type LostReasonKey = keyof typeof LOST_REASON_LABELS;

export interface MoveRequest {
  toStage: string;
  lostReason?: LostReasonKey | null;
  lostNote?: string | null;
}

/** Dropdown met fases. Kiest de gebruiker een "vervallen"-fase, dan eerst de reden. */
export function StageSelect({
  stages,
  value,
  onChange,
  disabled,
  className,
}: {
  stages: StageOption[];
  value: string;
  onChange: (req: MoveRequest) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [lostTarget, setLostTarget] = useState<string | null>(null);
  return (
    <>
      <Select
        aria-label="Fase"
        value={value}
        disabled={disabled}
        className={className}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const to = e.target.value;
          const st = stages.find((s) => s.key === to);
          if (st?.kind === "lost") setLostTarget(to);
          else onChange({ toStage: to });
        }}
      >
        {stages.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </Select>
      {lostTarget && (
        <LostDialog
          onCancel={() => setLostTarget(null)}
          onConfirm={(reason, note) => {
            onChange({ toStage: lostTarget, lostReason: reason, lostNote: note });
            setLostTarget(null);
          }}
        />
      )}
    </>
  );
}

export function LostDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: LostReasonKey, note: string | null) => void }) {
  const [reason, setReason] = useState<LostReasonKey | null>(null);
  const [note, setNote] = useState("");
  const invalid = !reason || (reason === "anders" && !note.trim());
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onCancel} onPointerDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 font-semibold">Waarom is dit traject vervallen?</h2>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(Object.keys(LOST_REASON_LABELS) as LostReasonKey[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-lg border px-3 py-2 text-sm ${reason === r ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}
            >
              {LOST_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <Textarea rows={2} placeholder={reason === "anders" ? "Toelichting (verplicht)" : "Toelichting (optioneel)"} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onCancel}>
            Annuleren
          </Button>
          <Button type="button" disabled={invalid} onClick={() => onConfirm(reason!, note.trim() || null)}>
            Opslaan
          </Button>
        </div>
      </div>
    </div>
  );
}
