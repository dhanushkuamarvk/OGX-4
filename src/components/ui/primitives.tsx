"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Activity, Cpu, ListTree, Search, User } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b7cf6]/60 disabled:pointer-events-none disabled:opacity-45 select-none whitespace-nowrap active:scale-[0.985]",
  {
    variants: {
      variant: {
        primary:
          "bg-[#7c6ce8] text-white hover:bg-[#8b7cf6] shadow-sm shadow-black/25 border border-white/10",
        secondary:
          "bg-surface-elevated text-zinc-100 border border-white/10 hover:bg-surface-hover hover:border-white/15",
        ghost: "text-zinc-300 hover:text-white hover:bg-white/[0.06]",
        danger:
          "bg-rose-500/12 text-rose-200 border border-rose-400/25 hover:bg-rose-500/20",
        success:
          "bg-emerald-500/12 text-emerald-200 border border-emerald-400/25 hover:bg-emerald-500/20",
        warning:
          "bg-amber-500/12 text-amber-200 border border-amber-400/25 hover:bg-amber-500/20",
        cyan:
          "bg-cyan-500/12 text-cyan-200 border border-cyan-400/25 hover:bg-cyan-500/20",
      },
      size: {
        xs: "h-7 px-2.5 text-xs",
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-5 text-sm",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
);
Button.displayName = "Button";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border leading-tight",
  {
    variants: {
      tone: {
        neutral: "bg-white/[0.04] text-zinc-300 border-white/10",
        purple: "bg-[#8b7cf6]/14 text-[#c5bcff] border-[#8b7cf6]/30",
        blue: "bg-sky-500/12 text-sky-200 border-sky-400/25",
        cyan: "bg-cyan-500/12 text-cyan-200 border-cyan-400/25",
        emerald: "bg-emerald-500/12 text-emerald-200 border-emerald-400/25",
        amber: "bg-amber-500/12 text-amber-200 border-amber-400/25",
        rose: "bg-rose-500/12 text-rose-200 border-rose-400/25",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("clean-card rounded-xl p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg bg-[#0e1119] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#8b7cf6]/65 focus:ring-2 focus:ring-[#8b7cf6]/20 transition-all duration-150",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg bg-[#0e1119] border border-white/10 px-3.5 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-[#8b7cf6]/65 focus:ring-2 focus:ring-[#8b7cf6]/20 transition-all duration-150 resize-none",
        className
      )}
      {...props}
    />
  );
}

export function ProgressBar({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]",
        className
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-[#8b7cf6] transition-all duration-300 ease-out",
          barClassName
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex group/tip", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-40 whitespace-nowrap rounded-md bg-[#1f2433] border border-white/15 px-2 py-1 text-[11px] font-medium text-zinc-100 shadow-lg opacity-0 translate-y-0.5 transition-all duration-150 group-hover/tip:opacity-100 group-hover/tip:translate-y-0 group-focus-within/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-white/10 bg-[#0e1119]/60 px-6 py-12 text-center space-y-3",
        className
      )}
    >
      <div className="mx-auto h-10 w-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
        <Icon className="h-5 w-5 text-[#a79bf9]" />
      </div>
      <div className="space-y-1 max-w-md mx-auto">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-zinc-400 leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-1 flex justify-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
}

export function getHumanStatusMeta(status: string): {
  label: string;
  sentence: string;
  tone: BadgeProps["tone"];
  pulse?: boolean;
} {
  const map: Record<
    string,
    { label: string; sentence: string; tone: BadgeProps["tone"]; pulse?: boolean }
  > = {
    pending: {
      label: "Up Next",
      sentence: "Queued and waiting to start.",
      tone: "neutral",
    },
    planning: {
      label: "Drafting Plan",
      sentence: "Organising your goal into clear steps.",
      tone: "purple",
      pulse: true,
    },
    awaiting_plan_approval: {
      label: "Ready for Review",
      sentence: "Your plan is ready for review.",
      tone: "amber",
    },
    running: {
      label: "In Progress",
      sentence: "Agents are working on the approved steps.",
      tone: "cyan",
      pulse: true,
    },
    working: {
      label: "Working",
      sentence: "Currently working on an assigned step.",
      tone: "cyan",
      pulse: true,
    },
    waiting_for_approval: {
      label: "Review Needed",
      sentence: "Your review is needed before continuing.",
      tone: "amber",
    },
    waiting_approval: {
      label: "Review Needed",
      sentence: "Waiting for your review before continuing.",
      tone: "amber",
    },
    paused: {
      label: "Paused",
      sentence: "Paused so you can edit or review before resuming.",
      tone: "amber",
    },
    completed: {
      label: "Completed",
      sentence: "All steps finished.",
      tone: "emerald",
    },
    approved: {
      label: "Approved",
      sentence: "Approved by you.",
      tone: "emerald",
    },
    edited_and_approved: {
      label: "Edited & Approved",
      sentence: "Approved with your adjustments.",
      tone: "cyan",
    },
    failed: {
      label: "Needs Attention",
      sentence: "I couldn't complete this step. You can retry or adjust it.",
      tone: "rose",
    },
    rejected: {
      label: "Redirected",
      sentence: "You asked the agent to take a different direction.",
      tone: "rose",
    },
    cancelled: {
      label: "Stopped",
      sentence: "Stopped by you.",
      tone: "rose",
    },
    online: {
      label: "Available",
      sentence: "Ready to collaborate.",
      tone: "emerald",
    },
    offline: {
      label: "Offline",
      sentence: "Currently turned off.",
      tone: "neutral",
    },
    idle: {
      label: "Ready",
      sentence: "Ready to start.",
      tone: "neutral",
    },
    skipped: {
      label: "Skipped",
      sentence: "Skipped at your request.",
      tone: "neutral",
    },
  };
  return (
    map[status] ?? {
      label: status.replace(/_/g, " "),
      sentence: status.replace(/_/g, " "),
      tone: "neutral",
    }
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cfg = getHumanStatusMeta(status);
  return (
    <Badge tone={cfg.tone}>
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          cfg.pulse && "animate-pulse",
          cfg.tone === "emerald" && "bg-emerald-400",
          cfg.tone === "cyan" && "bg-cyan-400",
          cfg.tone === "purple" && "bg-[#a79bf9]",
          cfg.tone === "amber" && "bg-amber-400",
          cfg.tone === "rose" && "bg-rose-400",
          cfg.tone === "neutral" && "bg-zinc-400"
        )}
      />
      {cfg.label}
    </Badge>
  );
}

export function getAgentStyle(role: string) {
  switch (role) {
    case "research-agent":
      return {
        label: "Research Agent",
        shortLabel: "Research",
        icon: Search,
        description: "Finds relevant information and supporting evidence.",
        communicationStyle: "Informative and clear",
        dot: "bg-cyan-400",
        text: "text-cyan-300",
        accentBorder: "border-cyan-400/30",
        avatarBg: "bg-cyan-500/12 border-cyan-400/30 text-cyan-300",
        pill: "bg-cyan-500/12 text-cyan-200 border-cyan-400/25",
      };
    case "planning-agent":
      return {
        label: "Planning Agent",
        shortLabel: "Planning",
        icon: ListTree,
        description: "Organises tasks and creates structured plans.",
        communicationStyle: "Organised and helpful",
        dot: "bg-[#a79bf9]",
        text: "text-[#c5bcff]",
        accentBorder: "border-[#8b7cf6]/35",
        avatarBg: "bg-[#8b7cf6]/14 border-[#8b7cf6]/35 text-[#c5bcff]",
        pill: "bg-[#8b7cf6]/14 text-[#c5bcff] border-[#8b7cf6]/30",
      };
    case "execution-agent":
      return {
        label: "Execution Agent",
        shortLabel: "Execution",
        icon: Activity,
        description: "Carries out assigned tasks and reports progress.",
        communicationStyle: "Concise and practical",
        dot: "bg-emerald-400",
        text: "text-emerald-300",
        accentBorder: "border-emerald-400/30",
        avatarBg: "bg-emerald-500/12 border-emerald-400/30 text-emerald-300",
        pill: "bg-emerald-500/12 text-emerald-200 border-emerald-400/25",
      };
    case "human":
      return {
        label: "You",
        shortLabel: "You",
        icon: User,
        description: "Guides goals, edits plans, and approves key decisions.",
        communicationStyle: "Human collaborator",
        dot: "bg-zinc-200",
        text: "text-zinc-200",
        accentBorder: "border-white/15",
        avatarBg: "bg-white/[0.08] border-white/15 text-zinc-100",
        pill: "bg-white/[0.07] text-zinc-200 border-white/12",
      };
    default:
      return {
        label: "Workflow Update",
        shortLabel: "Update",
        icon: Cpu,
        description: "Tracks progress across the workflow.",
        communicationStyle: "Clear status updates",
        dot: "bg-zinc-400",
        text: "text-zinc-400",
        accentBorder: "border-white/10",
        avatarBg: "bg-white/[0.04] border-white/10 text-zinc-400",
        pill: "bg-white/[0.04] text-zinc-400 border-white/10",
      };
  }
}

export function AgentAvatar({
  role,
  size = "sm",
  className,
}: {
  role: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const style = getAgentStyle(role);
  const Icon = style.icon;
  const sizes = {
    xs: "h-6 w-6 rounded-md",
    sm: "h-7 w-7 rounded-lg",
    md: "h-9 w-9 rounded-lg",
    lg: "h-11 w-11 rounded-xl",
  };
  const iconSizes = {
    xs: "h-3 w-3",
    sm: "h-3.5 w-3.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center border shrink-0",
        style.avatarBg,
        sizes[size],
        className
      )}
      aria-hidden="true"
    >
      <Icon className={iconSizes[size]} />
    </span>
  );
}
