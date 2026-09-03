import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export const AccessDeniedPage = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-4 text-center">
      <ShieldAlert className="w-16 h-16 text-error mb-4" />
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Access Denied</h1>
      <p className="text-slate-500 mb-8 max-w-md">
        You do not have permission to view this page. If you believe this is an error, contact your administrator.
      </p>
      <Link
        to="/"
        className="bg-primary-600 text-white px-6 py-2 rounded-md hover:bg-primary-700 transition-colors font-medium"
      >
        Return to Dashboard
      </Link>
    </div>
  );
};
