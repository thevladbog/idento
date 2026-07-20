import { Check, CircleHelp, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/cn";
import type { Verdict } from "../lib/verdict";

export interface VerdictAction {
  label: string;
  onClick: () => void;
  kind: "solid" | "outline";
}

export interface VerdictScreenProps {
  verdict: Verdict;
  title: string;
  name?: string;
  message?: string;
  meta?: { label: string; value: string }[];
  highlight?: string;
  cornerNote?: string;
  actions?: VerdictAction[];
  autoReturn?: { label: string; progress: number };
  privacy?: boolean;
  className?: string;
}

const STYLES: Record<Verdict, { field: string; disc: string; icon: typeof Check; iconCls: string; solid: string; outline: string; muted: string; highlight: string; track: string }> = {
  allowed: {
    field: "bg-kiosk-brand text-kiosk-text", disc: "bg-kiosk-overlay-light", icon: Check, iconCls: "text-kiosk-text",
    solid: "bg-kiosk-text text-kiosk-brand", outline: "border-[3px] border-kiosk-text/50",
    muted: "opacity-70", highlight: "border-kiosk-overlay-light bg-kiosk-overlay-light", track: "bg-kiosk-overlay-track",
  },
  already_checked_in: {
    field: "bg-kiosk-warn text-kiosk-warn-ink", disc: "bg-kiosk-warn-ink", icon: TriangleAlert, iconCls: "text-kiosk-warn",
    solid: "bg-kiosk-warn-ink text-kiosk-warn-text", outline: "border-[3px] border-kiosk-warn-ink/40",
    muted: "opacity-65", highlight: "border-kiosk-warn-ink/30 bg-kiosk-warn-ink/10", track: "bg-kiosk-warn-ink/25",
  },
  not_registered: {
    field: "bg-kiosk-neutral text-kiosk-text", disc: "bg-kiosk-overlay-light", icon: CircleHelp, iconCls: "text-kiosk-text",
    solid: "bg-kiosk-brand text-kiosk-text", outline: "border-[3px] border-kiosk-outline text-kiosk-text-2",
    muted: "text-kiosk-text-3", highlight: "border-kiosk-outline bg-kiosk-overlay-light", track: "bg-kiosk-overlay-track",
  },
  no_access: {
    field: "bg-kiosk-danger text-kiosk-text", disc: "bg-kiosk-overlay-ink", icon: X, iconCls: "text-kiosk-text",
    solid: "bg-kiosk-text text-kiosk-danger", outline: "border-[3px] border-kiosk-text/50",
    muted: "opacity-75", highlight: "border-kiosk-overlay-ink bg-kiosk-overlay-ink", track: "bg-kiosk-overlay-track",
  },
};

function AutoReturn({ label, progress, track }: { label: string; progress: number; track: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex items-center gap-7">
      <span className="shrink-0 opacity-85" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>{label}</span>
      <span role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className={cn("block h-2.5 flex-1 overflow-hidden rounded-[5px]", track)}>
        <span className="block h-full rounded-[5px] bg-kiosk-text" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** Полноэкранный вердикт: цвет всегда дублирован иконкой и подписью; privacy — self-service вариант. */
export function VerdictScreen({ verdict, title, name, message, meta, highlight, cornerNote, actions, autoReturn, privacy, className }: VerdictScreenProps) {
  const s = STYLES[verdict];
  const Icon = s.icon;

  if (privacy) {
    return (
      <section role="status" data-verdict={verdict} data-privacy="true" className={cn("relative flex h-full flex-col items-center justify-center gap-11 p-20 text-center", s.field, className)} style={{ fontFamily: "var(--kiosk-font)" }}>
        <span aria-hidden className={cn("grid size-36 place-items-center rounded-full", s.disc)}>
          <Icon className={cn("size-20", s.iconCls)} strokeWidth={3} />
        </span>
        {name && <div className="kiosk-type-verdict-name">{name}</div>}
        {message && <div className="font-bold opacity-95" style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.96)" }}>{message}</div>}
        {autoReturn && <div className="absolute inset-x-20 bottom-16"><AutoReturn {...autoReturn} track={s.track} /></div>}
      </section>
    );
  }

  return (
    <section role="status" data-verdict={verdict} className={cn("flex h-full flex-col p-[clamp(32px,6vh,88px)_clamp(36px,5vw,96px)]", s.field, className)} style={{ fontFamily: "var(--kiosk-font)" }}>
      <div className="flex items-center gap-8">
        <span aria-hidden className={cn("grid size-[110px] shrink-0 place-items-center rounded-full", s.disc)}>
          <Icon className={cn("size-14", s.iconCls)} strokeWidth={3} />
        </span>
        <span className="kiosk-type-verdict-title">{title}</span>
        {cornerNote && <span className="ml-auto opacity-80 tabular-nums" style={{ fontSize: "var(--kiosk-fs-idle-sub)" }}>{cornerNote}</span>}
      </div>
      {name && <div className="kiosk-type-verdict-name mt-14">{name}</div>}
      {message && <div className="mt-14 max-w-[1400px] font-extrabold leading-tight tracking-tight" style={{ fontSize: "calc(var(--kiosk-fs-verdict-name) * 0.48)" }}>{message}</div>}
      {highlight && (
        <div className={cn("mt-9 self-start rounded-2xl border-2 px-9 py-7 font-extrabold", s.highlight)} style={{ fontSize: "calc(var(--kiosk-fs-verdict-title) * 0.87)" }}>
          {highlight}
        </div>
      )}
      {meta && meta.length > 0 && (
        <dl className="mt-11 grid grid-cols-[280px_1fr] gap-x-7 gap-y-5" style={{ fontSize: "calc(var(--kiosk-fs-idle-sub) * 1.14)" }}>
          {meta.map((m) => (
            <div key={m.label} className="contents">
              <dt className={s.muted}>{m.label}</dt>
              <dd className="font-bold">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-auto flex flex-col gap-6 pt-8">
        {actions && actions.length > 0 && (
          <div className="flex gap-6">
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={a.onClick} className={cn("grid h-24 flex-1 place-items-center rounded-2xl font-extrabold", a.kind === "solid" ? s.solid : s.outline)} style={{ fontSize: "calc(var(--kiosk-fs-idle-sub) * 1.14)" }}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        {autoReturn && <AutoReturn {...autoReturn} track={s.track} />}
      </div>
    </section>
  );
}
