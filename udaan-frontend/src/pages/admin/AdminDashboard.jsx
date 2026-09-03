import { useAuth } from '../../context/AuthContext';

export const AdminDashboard = () => {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <p className="text-slate-600">Welcome, {user?.name}. Your dashboard is under construction.</p>
      </div>
    </div>
  );
};
