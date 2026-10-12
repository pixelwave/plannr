import { Calendar, CalendarDays, CalendarRange, Crosshair, Minimize2, Sun } from "lucide-react";
import BarMenu from "./BarMenu";

type Zoom = "month" | "week" | "day";

export default function ViewMenu({
  zoom,
  onCenter,
  onToday,
  onCompact,
  onZoom,
}: {
  zoom: Zoom;
  onCenter: () => void;
  onToday: () => void;
  onCompact: () => void;
  onZoom: (band: Zoom) => void;
}) {
  return (
    <BarMenu
      label="FOCUS"
      items={[
        { id: "center", label: "Center", icon: Crosshair },
        { id: "today", label: "Today", icon: Sun },
        { id: "month", label: "Month", icon: Calendar, sep: true, on: zoom === "month" },
        { id: "week", label: "Week", icon: CalendarRange, on: zoom === "week" },
        { id: "day", label: "Day", icon: CalendarDays, on: zoom === "day" },
        { id: "compact", label: "Compact", icon: Minimize2, sep: true },
      ]}
      onPick={(id) => {
        if (id === "center") onCenter();
        else if (id === "today") onToday();
        else if (id === "compact") onCompact();
        else if (id === "month" || id === "week" || id === "day") onZoom(id);
      }}
    />
  );
}
