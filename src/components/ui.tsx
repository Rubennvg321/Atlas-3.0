"use client";

import clsx from "clsx";
import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return (
    <button
      {...p}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50",
        variant === "primary" && "bg-stone-900 text-white hover:bg-stone-700",
        variant === "secondary" && "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "text-stone-600 hover:bg-stone-200/60",
        className,
      )}
    />
  );
}

export function SubmitButton({ children, pendingText, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...p}>
      {pending ? (pendingText ?? "Bezig…") : children}
    </Button>
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={clsx("w-full rounded-lg border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200", className)} />;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={clsx("w-full rounded-lg border border-stone-300 bg-white px-3 py-2 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200", className)} />;
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={clsx("rounded-lg border border-stone-300 bg-white px-2.5 py-2 outline-none focus:border-stone-500", className)} />;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export function FormMessage({ state }: { state: { ok: boolean; error?: string } | null | undefined }) {
  if (!state) return null;
  if (state.ok) return null;
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{"error" in state ? state.error : null}</p>;
}
