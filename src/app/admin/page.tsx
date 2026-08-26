import { createClient } from "@/lib/supabase/server";
import { saveAvailability } from "@/app/admin/actions";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function AdminPage() {
  const supabase = await createClient();

  const { data: court } = await supabase.from("courts").select("id, name").limit(1).single();

  if (!court) {
    return <p className="text-gray-600">No court has been set up yet. Run the database seed.</p>;
  }

  const { data: rules } = await supabase
    .from("availability_rules")
    .select("day_of_week, open_time, close_time")
    .eq("court_id", court.id);

  const rulesByDay = new Map((rules ?? []).map((r) => [r.day_of_week, r]));

  return (
    <div>
      <h2 className="text-lg font-medium">Weekly availability — {court.name}</h2>
      <p className="mt-1 text-sm text-gray-600">
        Leave both times blank for a day the court is closed. Saving replaces the full week.
      </p>

      <form action={saveAvailability} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="court_id" value={court.id} />
        {DAY_NAMES.map((name, day) => {
          const rule = rulesByDay.get(day);
          return (
            <div key={day} className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-center sm:gap-3">
              <label className="text-sm font-medium">{name}</label>
              <input
                type="time"
                name={`open_${day}`}
                defaultValue={rule?.open_time?.slice(0, 5)}
                className="w-full rounded border px-3 py-2 text-sm"
              />
              <input
                type="time"
                name={`close_${day}`}
                defaultValue={rule?.close_time?.slice(0, 5)}
                className="w-full rounded border px-3 py-2 text-sm"
              />
            </div>
          );
        })}
        <button type="submit" className="mt-4 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Save
        </button>
      </form>
    </div>
  );
}
