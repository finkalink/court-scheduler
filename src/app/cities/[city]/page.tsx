import Link from "next/link";
import CityContent from "@/components/CityContent";

export default async function CityPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: cityParam } = await params;
  const city = decodeURIComponent(cityParam);

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href="/cities" className="text-sm underline">
        &larr; All cities
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">{city}</h1>

      <CityContent city={city} />
    </div>
  );
}
