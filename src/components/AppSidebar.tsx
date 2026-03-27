import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Play,
  Settings,
  Radio,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/activity', icon: Activity, label: 'Activity' },
  { to: '/approvals', icon: ShieldCheck, label: 'Approvals' },
  { to: '/failures', icon: AlertTriangle, label: 'Failures' },
  { to: '/replay', icon: Play, label: 'Replay' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

const AppSidebar = () => {
  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-sidebar border-r border-sidebar-border flex flex-col z-50">
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center glow-primary">
            <Radio className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-wide">ClawOps</h1>
            <p className="text-[10px] text-muted-foreground font-mono">OPERATIONS CONSOLE</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs text-muted-foreground font-mono">OpenClaw Connected</span>
        </div>
      </div>
    </aside>
  );
};

export default AppSidebar;
