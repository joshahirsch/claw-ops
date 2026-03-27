import { ReactNode } from 'react';

interface KPICardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  variant?: 'default' | 'primary' | 'warning' | 'error' | 'success';
}

const variantStyles = {
  default: 'border-border',
  primary: 'border-primary/20 glow-primary',
  warning: 'border-warning/20 glow-warning',
  error: 'border-destructive/20 glow-error',
  success: 'border-success/20',
};

const variantTextStyles = {
  default: 'text-foreground',
  primary: 'text-primary',
  warning: 'text-warning',
  error: 'text-destructive',
  success: 'text-success',
};

const KPICard = ({ label, value, icon, variant = 'default' }: KPICardProps) => {
  return (
    <div className={`glass rounded-lg p-4 ${variantStyles[variant]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <p className={`text-2xl font-bold font-mono ${variantTextStyles[variant]}`}>{value}</p>
    </div>
  );
};

export default KPICard;
