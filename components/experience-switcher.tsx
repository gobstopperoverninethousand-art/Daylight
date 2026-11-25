"use client";
import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Palette, Layers } from "lucide-react";
import {
  EXPERIENCES,
  type ExperienceId,
  getExperience,
} from "@/lib/experiences";

export function ExperienceSwitcher({
  value,
  onChange,
  placement = "down",
}: {
  value: ExperienceId;
  onChange: (next: ExperienceId) => void;
  placement?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = getExperience(value);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const classic = EXPERIENCES.filter((e) => e.category === "classic");
  const wild = EXPERIENCES.filter((e) => e.category === "wild");

  return (
    <div className="experience-switcher" ref={wrapRef}>
      <button
        type="button"
        className="experience-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Switch visual style (current: ${current.name})`}
        title={`Visual style: ${current.name}`}
      >
        <span className="experience-swatches" aria-hidden="true">
          {current.swatches.map((color, idx) => (
            <i key={idx} style={{ backgroundColor: color }} />
          ))}
        </span>
        <span className="experience-trigger-label">{current.shortName}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open && (
        <div
          className={`experience-menu ${placement === "up" ? "open-up" : ""}`}
          role="menu"
          aria-label="Choose visual style and workspace layout"
        >
          <div className="experience-menu-head">
            <Palette size={14} aria-hidden="true" />
            <div>
              <strong>{EXPERIENCES.length} workspace styles &amp; paradigms</strong>
              <span>All workspace data stays live &amp; synced · Alt+[ / ]</span>
            </div>
          </div>

          <div className="experience-menu-scroll">
            <div className="experience-menu-group-label">
              Wild Interpretations
            </div>
            <div className="experience-menu-list">
              {wild.map((exp) => {
                const idx = EXPERIENCES.findIndex((item) => item.id === exp.id);
                const active = exp.id === value;
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    key={exp.id}
                    className={
                      "experience-option is-wild " + (active ? "active" : "")
                    }
                    onClick={() => {
                      onChange(exp.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="experience-option-swatches"
                      aria-hidden="true"
                    >
                      {exp.swatches.map((color, cIdx) => (
                        <i key={cIdx} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="experience-option-body">
                      <span className="experience-option-title">
                        <strong>
                          {idx + 1}. {exp.name}
                        </strong>
                        <small>{exp.wildModeLabel}</small>
                      </span>
                      <span className="experience-option-desc">
                        {exp.layoutSummary}
                      </span>
                    </span>
                    {active && (
                      <Check
                        size={15}
                        className="experience-option-check"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="experience-menu-group-label">
              Editorial &amp; Studio Workspaces
            </div>
            <div className="experience-menu-list">
              {classic.map((exp) => {
                const idx = EXPERIENCES.findIndex((item) => item.id === exp.id);
                const active = exp.id === value;
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    key={exp.id}
                    className={"experience-option " + (active ? "active" : "")}
                    onClick={() => {
                      onChange(exp.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="experience-option-swatches"
                      aria-hidden="true"
                    >
                      {exp.swatches.map((color, cIdx) => (
                        <i key={cIdx} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="experience-option-body">
                      <span className="experience-option-title">
                        <strong>
                          {idx + 1}. {exp.name}
                        </strong>
                        <small>{exp.typography}</small>
                      </span>
                      <span className="experience-option-desc">
                        {exp.layoutSummary}
                      </span>
                    </span>
                    {active && (
                      <Check
                        size={15}
                        className="experience-option-check"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ExperienceGallery({
  value,
  onChange,
}: {
  value: ExperienceId;
  onChange: (next: ExperienceId) => void;
}) {
  return (
    <section className="panel experience-gallery-panel">
      <div className="settings-heading">
        <Layers size={19} />
        <h2>Visual style &amp; workspace paradigm</h2>
      </div>
      <p>
        Switch between five studio classics and thirteen experimental spatial
        workspaces—including Sundial, Studio Tape, CRT Console, Desktop 98,
        Focus Deck, Metro Transit, CAD Blueprint, Dot-Grid Journal, Museum
        Exhibition, Orbital Constellation, Modular Patch Rack, Risograph Zine,
        and Tactical Arena—with Alt+[ / ], Alt+1–0, or this gallery.
      </p>
      <div
        className="experience-gallery-grid"
        role="radiogroup"
        aria-label="Workspace visual styles"
      >
        {EXPERIENCES.map((exp, index) => {
          const active = exp.id === value;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={active}
              key={exp.id}
              className={
                "experience-gallery-card " +
                (exp.category === "wild" ? "is-wild " : "") +
                (active ? "active" : "")
              }
              onClick={() => onChange(exp.id)}
            >
              <div className="experience-gallery-preview" aria-hidden="true">
                {exp.swatches.map((c, idx) => (
                  <span key={idx} style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="experience-gallery-copy">
                <div className="experience-gallery-top">
                  <strong>
                    {String(index + 1).padStart(2, "0")}. {exp.name}
                  </strong>
                  {active ? (
                    <Check size={14} />
                  ) : exp.category === "wild" ? (
                    <em className="exp-mode-tag">{exp.wildModeLabel}</em>
                  ) : null}
                </div>
                <p>{exp.tagline}</p>
                <small>{exp.layoutSummary}</small>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
