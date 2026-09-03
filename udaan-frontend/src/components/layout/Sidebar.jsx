import { NavLink } from 'react-router-dom';
import { Plane, LayoutDashboard, X, FileText, CheckSquare, Settings } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const roleMenus = {
  applicant: [
    { name: 'Dashboard', path: '/applicant', icon: LayoutDashboard },
    { name: 'My Applications', path: '/applicant/applications', icon: FileText },
  ],
  officer: [
    { name: 'Dashboard', path: '/officer', icon: LayoutDashboard },
    { name: 'Pending Reviews', path: '/officer/reviews', icon: CheckSquare },
  ],
  inspector: [
    { name: 'Dashboard', path: '/inspector', icon: LayoutDashboard },
    { name: 'Inspections', path: '/inspector/inspections', icon: CheckSquare },
  ],
  admin: [
    { name: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { name: 'Analytics', path: '/admin/analytics', icon: FileText },
    { name: 'Settings', path: '/admin/settings', icon: Settings },
  ],
};

export const Sidebar = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const menus = roleMenus[user?.role] || [];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 bg-primary-900 text-white transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-primary-800">
          <div className="flex items-center space-x-2">
            <Plane className="w-8 h-8 text-secondary-400" />
            <span className="text-2xl font-bold tracking-tight">UDAAN</span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-primary-200 hover:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {menus.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-800 text-white'
                    : 'text-primary-100 hover:bg-primary-800 hover:text-white'
                )
              }
              end={item.path === `/${user?.role}`} // exact match for root dashboard
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.name}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
};
