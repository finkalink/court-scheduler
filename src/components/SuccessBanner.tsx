export default function SuccessBanner({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">{children}</p>;
}
