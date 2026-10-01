import { Compass, TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </div>
  );
}

export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";

  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={TriangleAlert}
        tone="danger"
        title="Something went wrong"
        description={message}
        action={
          <Button variant="outline" size="sm" onClick={() => window.location.assign("#/")}>
            Reload home
          </Button>
        }
      />
    </div>
  );
}
