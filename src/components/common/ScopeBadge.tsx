import { Badge } from "@/components/ui/badge";

/** Where Claude Code reads an agent or skill from. */
export function ScopeBadge({ scope }: { scope: "user" | "project" }) {
  return (
    <Badge variant={scope === "project" ? "secondary" : "outline"}>{scope === "project" ? "Project" : "User"}</Badge>
  );
}
