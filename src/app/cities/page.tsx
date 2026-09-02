import AllCitiesContent from "@/components/AllCitiesContent";

export default function CitiesPage() {
  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
      <AllCitiesContent />
    </div>
  );
}
