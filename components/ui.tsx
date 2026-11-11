"use client";
import { useEffect, useRef, ReactNode } from "react";
import { X, Plus, ArrowUpRight, Inbox } from "lucide-react";
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={"icon-button " + className}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Empty({
  title,
  description,
  action,
  label = "Add your first task",
}: {
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Inbox size={23} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="button secondary" onClick={action}>
          <Plus size={15} />
          {label}
        </button>
      )}
    </div>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    ref.current
      ?.querySelector<HTMLInputElement>(
        "input:not([type=hidden]), textarea, select",
      )
      ?.focus();
    const d = ref.current;
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"dialog " + (wide ? "wide" : "")}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SectionHead({
  title,
  subtitle,
  action,
  label = "View all",
}: {
  title: string;
  subtitle?: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && (
        <button className="text-button" onClick={action}>
          {label}
          <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}
export const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const OUTCOMES = [
  ["pending", "Not recorded"],
  ["completed", "Completed"],
  ["partial-low", "Partial · a little"],
  ["partial-medium", "Partial · some"],
  ["partial-high", "Partial · most"],
  ["blocked", "Blocked"],
  ["skipped", "Skipped"],
] as const;
export function OutcomeSelect({
  value,
  onChange,
  compact = false,
  label = "Session outcome",
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
  label?: string;
}) {
  return (
    <select
      className={"outcome-select " + (compact ? "compact" : "")}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {OUTCOMES.map(([key, label]) => (
        <option value={key} key={key}>
          {label}
        </option>
      ))}
    </select>
  );
}
