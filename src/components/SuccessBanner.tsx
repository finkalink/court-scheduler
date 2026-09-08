export default function SuccessBanner({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded bg-success-bg p-3 text-sm text-success-fg">
      {children}
    </p>
  );
}
