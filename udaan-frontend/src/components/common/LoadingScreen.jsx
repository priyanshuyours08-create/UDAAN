export const LoadingScreen = () => {
  return (
    <div className="min-h-screen bg-bg-neutral flex items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600 mb-4"></div>
        <p className="text-slate-600 font-medium">Loading UDAAN...</p>
      </div>
    </div>
  );
};
