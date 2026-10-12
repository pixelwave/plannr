import { Download, Folder, Plus, Trash2, Upload } from "lucide-react";
import BarMenu from "./BarMenu";
import type { ProjectInfo } from "./calendar/persist";

export default function ProjectMenu({
  projects,
  currentId,
  projectName,
  canDelete,
  onNew,
  onSelect,
  onExport,
  onImport,
  onDelete,
}: {
  projects: ProjectInfo[];
  currentId: string;
  projectName: string;
  canDelete: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onExport: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  return (
    <BarMenu
      label="PLANNR"
      ariaLabel="Project"
      variant="wordmark"
      items={[
        { id: "new", label: "New", icon: Plus },
        {
          id: "browse",
          label: "Browse",
          icon: Folder,
          suffix: "›",
          submenu: projects.map((project) => ({
            id: `open:${project.id}`,
            label: project.name,
            on: project.id === currentId,
          })),
        },
        { id: "export", label: "Export", icon: Download },
        { id: "import", label: "Import", icon: Upload },
        { id: "delete", label: `Delete ${projectName}`, icon: Trash2, sep: true, disabled: !canDelete, danger: true },
      ]}
      onPick={(id) => {
        if (id === "new") onNew();
        else if (id.startsWith("open:")) onSelect(id.slice(5));
        else if (id === "export") onExport();
        else if (id === "import") onImport();
        else if (id === "delete") onDelete();
      }}
    />
  );
}
