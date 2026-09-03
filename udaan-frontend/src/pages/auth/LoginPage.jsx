import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plane } from 'lucide-react';
import { loginSchema } from '../../schemas/authSchemas';
import { login } from '../../api/authApi';
import { useAuth } from '../../context/AuthContext';
import { extractApiError } from '../../utils/errors';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';

export const LoginPage = () => {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
  });
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { login: loginAuth } = useAuth();

  const onSubmit = async (data) => {
    try {
      setIsLoading(true);
      const res = await login(data);
      loginAuth(res.token, res.user);
      toast.success('Logged in successfully');
      navigate(`/${res.user.role}`);
    } catch (error) {
      toast.error(extractApiError(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-neutral p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-slate-200 p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center space-x-2 text-primary-900 mb-2">
            <Plane className="w-8 h-8" />
            <span className="text-2xl font-bold tracking-tight">UDAAN</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-800">Welcome Back</h1>
          <p className="text-sm text-slate-500">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" className="w-full" isLoading={isLoading}>
            Sign In
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-600">
          Don't have an account?{' '}
          <Link to="/register" className="text-primary-600 hover:text-primary-700 font-medium hover:underline">
            Register here
          </Link>
        </div>
      </div>
    </div>
  );
};
