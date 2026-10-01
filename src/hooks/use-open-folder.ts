import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { useProjectStore } from "@/stores/projectStore";

/** "Open folder": native folder picker (Rust), then opens the project. */
export function useOpenFolder() {
  const navigate = useNavigate();
  const openFolderInStore = useProjectStore((s) => s.openFolder);
  const [opening, setOpening] = useState(false);

  const openFolder = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      const project = await openFolderInStore();
      if (project) void navigate(`/projects/${project.id}`);
    } catch (error) {
      toast.error("Could not open the folder", { description: errorMessage(error) });
    } finally {
      setOpening(false);
    }
  }, [opening, openFolderInStore, navigate]);

  return { openFolder, opening };
}
