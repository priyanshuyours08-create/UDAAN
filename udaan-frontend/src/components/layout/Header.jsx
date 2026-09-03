import { Menu, LogOut, User, Plane } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export const Header = ({ onMenuClick }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 sticky top-0 z-10">
      <div className="flex items-center space-x-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex items-center space-x-2 text-primary-900 lg:hidden">
          <Plane className="w-6 h-6" />
          <span className="text-xl font-bold tracking-tight">UDAAN</span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="hidden sm:flex items-center space-x-2 text-slate-700">
          <User className="w-5 h-5 text-slate-400" />
          <span className="text-sm font-medium">{user?.name} ({user?.role})</span>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center space-x-1 text-sm font-medium text-slate-600 hover:text-error transition-colors p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-error focus:ring-offset-2"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};
