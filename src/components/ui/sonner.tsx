import { Toaster as Sonner, toast } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      closeButton
      position="bottom-right"
      richColors={false}
      toastOptions={{
        style: {
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(20px) saturate(140%)',
          WebkitBackdropFilter: 'blur(20px) saturate(140%)',
          border: '1px solid rgba(34, 211, 238, 0.25)',
          borderRadius: '16px',
          color: '#e2e8f0',
          boxShadow:
            '0 10px 40px rgba(0,0,0,0.6), 0 0 30px rgba(34,211,238,0.15)',
          fontSize: '13px',
          padding: '12px 32px 12px 16px',
        },
        className: 'ip-toast',
        classNames: {
          toast: 'group toast',
          description: '!text-slate-400',
          actionButton: '!bg-cyan-500/20 !text-cyan-300 !border !border-cyan-500/30 !font-semibold',
          cancelButton: '!bg-white/5 !text-slate-400 !border !border-white/10',
          closeButton: '!bg-transparent !border-none !text-white/25 hover:!text-white/70',
          success: '!border-emerald-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(16,185,129,0.1)]',
          error: '!border-red-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(239,68,68,0.1)]',
          warning: '!border-amber-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(245,158,11,0.1)]',
          info: '!border-cyan-500/25 !shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(34,211,238,0.1)]',
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
