"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { moveTrajectAction } from "@/app/actions";
import { appointmentLabel, euro, isOverdue, relativeDays, shortDate } from "@/lib/format";
import { LostDialog, StageSelect, type MoveRequest, type StageOption, LOST_REASON_LABELS } from "./stage-control";

export interface CardData {
  id: string;
  number: number;
  stage: string;
  version: number;
  customerId: string;
  name: string;
  city: string | null;
  saleExcl: string | null;
  quoteNumber: string | null;
  purchaseExcl: string | null;
  montageDays: number | null;
  marginPerDay: number | null;
  nextAppointmentAt: string | null;
  nextAppointmentTitle: string | null;
  nextTaskTitle: string | null;
  nextTaskDueAt: string | null;
  openTasks: number;
  hasDuplicate: boolean;
  lostReason: string | null;
}

interface Column extends StageOption {
  color: string;
}

const COLUMN_ACCENT: Record<string, string> = {
  sky: "border-t-sky-400",
  amber: "border-t-amber-400",
  violet: "border-t-violet-400",
  emerald: "border-t-emerald-500",
  rose: "border-t-rose-400",
  slate: "border-t-slate-400",
  zinc: "border-t-zinc-400",
  orange: "border-t-orange-400",
  teal: "border-t-teal-500",
  indigo: "border-t-indigo-400",
};

const REFRESH_MS = 15000;

export function Board({ columns, allStages, cards: initial, lostKey }: { columns: Column[]; allStages: StageOption[]; cards: CardData[]; lostKey: string | null }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ card: CardData; toStage: string } | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [, startTransition] = useTransition();
  const inFlight = useRef(0);

  // Serverdata is de waarheid: zodra die ververst, nemen we hem over
  // (behalve terwijl er nog een eigen wijziging onderweg is).
  useEffect(() => {
    if (inFlight.current === 0) setCards(initial);
  }, [initial]);

  // Tweede apparaat: periodiek en bij terugkeren naar het venster verversen.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && inFlight.current === 0) startTransition(() => router.refresh());
    };
    const t = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  /** Eén functie voor slepen én dropdown. */
  const move = useCallback(
    async (card: CardData, req: MoveRequest) => {
      if (card.stage === req.toStage && !req.lostReason) return;
      const before = cards;
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: req.toStage, lostReason: req.lostReason ?? null } : c)));
      inFlight.current++;
      try {
        const res = await moveTrajectAction({
          trajectId: card.id,
          toStage: req.toStage,
          expectedVersion: card.version,
          lostReason: req.lostReason ?? null,
          lostNote: req.lostNote ?? null,
        });
        if (res.ok && res.data) {
          setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, version: res.data!.version, stage: res.data!.stage } : c)));
        } else if (!res.ok) {
          setCards(before);
          setToast({ text: res.error, error: true });
        }
      } catch {
        setCards(before);
        setToast({ text: "Opslaan mislukt. Controleer je verbinding.", error: true });
      } finally {
        inFlight.current--;
        startTransition(() => router.refresh());
      }
    },
    [cards, router],
  );

  const requestMove = (card: CardData, toStage: string) => {
    if (toStage === lostKey) setPendingLost({ card, toStage });
    else void move(card, { toStage });
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id ? String(e.over.id) : null;
    if (card && to && to !== card.stage) requestMove(card, to);
  };

  const byStage = useMemo(() => {
    const m = new Map<string, CardData[]>();
    for (const c of cards) m.set(c.stage, [...(m.get(c.stage) ?? []), c]);
    return m;
  }, [cards]);

  const activeCard = activeId ? cards.find((c) => c.id === activeId) : null;
  const columnsWithoutLost = columns.filter((c) => c.kind !== "lost");
  const lostColumn = columns.find((c) => c.kind === "lost");

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-4 md:mx-0 md:px-0" data-testid="board">
        {[...columnsWithoutLost, ...(lostColumn ? [lostColumn] : [])].map((col) => (
          <BoardColumn key={col.key} column={col} cards={byStage.get(col.key) ?? []} allStages={allStages} onMove={move} onRequestLost={(card) => setPendingLost({ card, toStage: col.key })} />
        ))}
      </div>
      {!lostColumn && lostKey && <LostDropZone visible={!!activeId} lostKey={lostKey} />}
      <DragOverlay dropAnimation={null}>{activeCard ? <CardView card={activeCard} allStages={allStages} overlay /> : null}</DragOverlay>
      {pendingLost && (
        <LostDialog
          onCancel={() => setPendingLost(null)}
          onConfirm={(reason, note) => {
            void move(pendingLost.card, { toStage: pendingLost.toStage, lostReason: reason, lostNote: note });
            setPendingLost(null);
          }}
        />
      )}
      {toast && (
        <div
          role="status"
          className={clsx(
            "fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg md:bottom-6",
            toast.error ? "bg-red-600" : "bg-stone-900",
          )}
        >
          {toast.text}
        </div>
      )}
    </DndContext>
  );
}

function BoardColumn({
  column,
  cards,
  allStages,
  onMove,
}: {
  column: Column;
  cards: CardData[];
  allStages: StageOption[];
  onMove: (card: CardData, req: MoveRequest) => void;
  onRequestLost: (card: CardData) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const total = cards.reduce((s, c) => s + (c.saleExcl ? Number(c.saleExcl) : 0), 0);
  return (
    <div
      ref={setNodeRef}
      data-stage={column.key}
      className={clsx(
        "flex w-[85vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border-t-4 bg-stone-200/60 sm:w-64",
        COLUMN_ACCENT[column.color] ?? "border-t-slate-400",
        isOver && "ring-2 ring-stone-500",
      )}
    >
      <div className="flex items-baseline justify-between px-3 pb-2 pt-2.5">
        <h2 className="text-sm font-semibold">
          {column.label} <span className="font-normal text-stone-500">{cards.length}</span>
        </h2>
        {total > 0 && <span className="text-xs text-stone-500" title="Verkoopwaarde excl. btw">{euro(total)}</span>}
      </div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} allStages={allStages} onMove={onMove} />
        ))}
      </div>
    </div>
  );
}

function DraggableCard({ card, allStages, onMove }: { card: CardData; allStages: StageOption[]; onMove: (card: CardData, req: MoveRequest) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={clsx("touch-manipulation", isDragging && "opacity-30")}>
      <CardView card={card} allStages={allStages} onMove={onMove} />
    </div>
  );
}

function CardView({ card, allStages, onMove, overlay }: { card: CardData; allStages: StageOption[]; onMove?: (card: CardData, req: MoveRequest) => void; overlay?: boolean }) {
  const stage = allStages.find((s) => s.key === card.stage);
  const active = stage && (stage.kind === "open" || stage.kind === "won");
  const overdue = active && card.nextTaskDueAt && isOverdue(card.nextTaskDueAt);
  const noAction = active && card.openTasks === 0;
  return (
    <article
      data-testid="card"
      data-traject={card.id}
      className={clsx(
        "rounded-lg border bg-white p-3 text-sm shadow-sm",
        overlay && "rotate-2 shadow-xl",
        overdue ? "border-red-400 bg-red-50/40" : noAction ? "border-amber-400 bg-amber-50/40" : "border-stone-200",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/trajecten/${card.id}`} className="font-medium leading-tight hover:underline" onPointerDown={(e) => e.stopPropagation()}>
          {card.name}
        </Link>
        {card.saleExcl && (
          <span className="shrink-0 font-medium text-stone-700" title="Verkoop excl. btw">
            {euro(card.saleExcl)}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
        <span>{card.city ?? "Plaats onbekend"}</span>
        <span>· #{card.number}</span>
        {card.quoteNumber && <span>· {card.quoteNumber}</span>}
        {card.hasDuplicate && <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">Mogelijk dubbel</span>}
      </div>
      {(card.purchaseExcl || card.marginPerDay !== null) && (
        <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-stone-600">
          {card.purchaseExcl && <span title="Inkoop excl. btw">Inkoop {euro(card.purchaseExcl)}</span>}
          {card.marginPerDay !== null && (
            <span className={clsx("font-medium", card.marginPerDay >= 0 ? "text-emerald-700" : "text-red-700")} title={`Marge per montagedag (${card.montageDays} dag(en))`}>
              {euro(card.marginPerDay)}/dag
            </span>
          )}
        </p>
      )}
      {card.nextAppointmentAt && (
        <p className="mt-2 text-xs text-stone-700">
          📅 {appointmentLabel(card.nextAppointmentAt)}
          {card.nextAppointmentTitle ? ` · ${card.nextAppointmentTitle}` : ""}
        </p>
      )}
      {stage?.kind === "lost" && card.lostReason && (
        <p className="mt-2 text-xs text-stone-600">Reden: {LOST_REASON_LABELS[card.lostReason as keyof typeof LOST_REASON_LABELS] ?? card.lostReason}</p>
      )}
      {active && (
        <p className={clsx("mt-2 text-xs", overdue ? "font-medium text-red-700" : noAction ? "font-medium text-amber-700" : "text-stone-700")}>
          {card.nextTaskTitle ? (
            <>
              ➜ {card.nextTaskTitle}
              {card.nextTaskDueAt && <span> · {overdue ? relativeDays(card.nextTaskDueAt) : shortDate(card.nextTaskDueAt)}</span>}
            </>
          ) : (
            "Geen volgende actie"
          )}
        </p>
      )}
      {onMove && (
        <div className="mt-2">
          <StageSelect stages={allStages} value={card.stage} onChange={(req) => onMove(card, req)} className="w-full py-1 text-xs" />
        </div>
      )}
    </article>
  );
}

function LostDropZone({ visible, lostKey }: { visible: boolean; lostKey: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: lostKey });
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-xl border-2 border-dashed px-8 py-4 text-sm font-medium transition md:bottom-6",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
        isOver ? "border-red-500 bg-red-50 text-red-700" : "border-stone-400 bg-white/95 text-stone-600",
      )}
    >
      Sleep hierheen: Vervallen
    </div>
  );
}
