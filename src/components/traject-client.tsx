"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { addNoteAction, addTaskAction, deleteTaskAction, moveTrajectAction, toggleTaskAction, updateTrajectAction } from "@/app/actions";
import { isOverdue, relativeDays, shortDate } from "@/lib/format";
import { StageSelect, type StageOption } from "./stage-control";
import { Button, Field, FormMessage, Input, SubmitButton, Textarea } from "./ui";

export function TrajectStageControl({ trajectId, stage, version, stages }: { trajectId: string; stage: string; version: number; stages: StageOption[] }) {
  const router = useRouter();
  const [value, setValue] = useState(stage);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setValue(stage), [stage]);
  // Ook hier: andere apparaten kunnen de fase wijzigen.
  useEffect(() => {
    const r = () => document.visibilityState === "visible" && router.refresh();
    window.addEventListener("focus", r);
    const t = setInterval(r, 20000);
    return () => {
      window.removeEventListener("focus", r);
      clearInterval(t);
    };
  }, [router]);
  return (
    <div>
      <StageSelect
        stages={stages}
        value={value}
        disabled={pending}
        className="font-medium"
        onChange={(req) => {
          const prev = value;
          setValue(req.toStage);
          setError(null);
          start(async () => {
            const res = await moveTrajectAction({ trajectId, expectedVersion: version, ...req });
            if (!res.ok) {
              setValue(prev);
              setError(res.error);
            }
            router.refresh();
          });
        }}
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function TaskForm({ trajectId }: { trajectId: string }) {
  const [state, action] = useActionState(addTaskAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="trajectId" value={trajectId} />
      <Input name="title" placeholder="Volgende actie, bijv. offerte opsturen" required />
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 text-xs text-stone-600">
          Deadline
          <input name="dueAt" type="date" aria-label="Deadline" className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5" />
        </label>
        <SubmitButton>Toevoegen</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function TaskItem({ task, path }: { task: { id: string; title: string; dueAt: string | null; doneAt: string | null }; path: string }) {
  const [pending, start] = useTransition();
  const done = !!task.doneAt;
  const overdue = !done && isOverdue(task.dueAt);
  return (
    <li className={clsx("flex items-start gap-3 py-2", pending && "opacity-50")}>
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 accent-stone-900"
        checked={done}
        onChange={() => start(() => toggleTaskAction(task.id, !done, path))}
        aria-label={done ? "Heropenen" : "Afronden"}
      />
      <div className="min-w-0 flex-1">
        <p className={clsx("text-sm", done && "text-stone-400 line-through")}>{task.title}</p>
        {task.dueAt && <p className={clsx("text-xs", overdue ? "font-medium text-red-700" : "text-stone-500")}>{overdue ? relativeDays(task.dueAt) : shortDate(task.dueAt)}</p>}
      </div>
      <button className="text-xs text-stone-400 hover:text-red-600" onClick={() => start(() => deleteTaskAction(task.id, path))} aria-label="Verwijderen">
        ✕
      </button>
    </li>
  );
}

export function NoteForm({ trajectId }: { trajectId: string }) {
  const [state, action] = useActionState(addNoteAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="trajectId" value={trajectId} />
      <Textarea name="body" rows={2} placeholder="Notitie toevoegen…" required />
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Opslaan</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function TrajectEditForm({
  traject,
}: {
  traject: {
    id: string;
    title: string | null;
    description: string | null;
    siteStreet: string | null;
    siteHouseNumber: number | null;
    siteHouseNumberAddition: string | null;
    sitePostcode: string | null;
    siteCity: string | null;
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateTrajectAction, null);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  if (!open) {
    return (
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setOpen(true)}>
        Bewerken
      </Button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
      <form action={action} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Traject bewerken</h2>
        <input type="hidden" name="id" value={traject.id} />
        <Field label="Titel (optioneel)">
          <Input name="title" defaultValue={traject.title ?? ""} placeholder="bijv. Open trap dicht + tapijt" />
        </Field>
        <Field label="Omschrijving">
          <Textarea name="description" rows={3} defaultValue={traject.description ?? ""} />
        </Field>
        <fieldset className="rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-xs font-medium text-stone-600">Afwijkend montageadres (leeg = klantadres)</legend>
          <div className="grid grid-cols-6 gap-2">
            <Field label="Straat" className="col-span-4">
              <Input name="siteStreet" defaultValue={traject.siteStreet ?? ""} />
            </Field>
            <Field label="Nr" className="col-span-1">
              <Input name="siteHouseNumber" inputMode="numeric" defaultValue={traject.siteHouseNumber ?? ""} />
            </Field>
            <Field label="Toev." className="col-span-1">
              <Input name="siteHouseNumberAddition" defaultValue={traject.siteHouseNumberAddition ?? ""} />
            </Field>
            <Field label="Postcode" className="col-span-2">
              <Input name="sitePostcode" defaultValue={traject.sitePostcode ?? ""} />
            </Field>
            <Field label="Plaats" className="col-span-4">
              <Input name="siteCity" defaultValue={traject.siteCity ?? ""} />
            </Field>
          </div>
        </fieldset>
        <FormMessage state={state} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Annuleren
          </Button>
          <SubmitButton>Opslaan</SubmitButton>
        </div>
      </form>
    </div>
  );
}

export function ConfirmAction({ label, confirm, action, variant = "secondary", className }: { label: string; confirm: string; action: () => Promise<unknown>; variant?: "secondary" | "danger" | "ghost" | "primary"; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant={variant}
      disabled={pending}
      className={className}
      onClick={() => {
        if (window.confirm(confirm)) start(async () => void (await action()));
      }}
    >
      {pending ? "Bezig…" : label}
    </Button>
  );
}
