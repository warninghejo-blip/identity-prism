import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        style: {
          background: 'rgba(8, 12, 24, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(99, 179, 237, 0.15)',
          borderRadius: '14px',
          color: '#e2e8f0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(56,189,248,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
          fontSize: '13px',
          padding: '12px 16px',
        },
        classNames: {
          toast: "group toast text-center items-center justify-center",
          description: "!text-slate-400",
          actionButton: "!bg-cyan-500/20 !text-cyan-300 !border !border-cyan-500/30 !font-semibold",
          cancelButton: "!bg-white/5 !text-slate-400 !border !border-white/10",
          success: "!border-emerald-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(16,185,129,0.1)]",
          error: "!border-red-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(239,68,68,0.1)]",
          warning: "!border-amber-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(245,158,11,0.1)]",
          info: "!border-cyan-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(34,211,238,0.1)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
