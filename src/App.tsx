import { RouterProvider } from "react-router/dom";
import { router } from "@/app/router";
import { AuthGate } from "@/components/auth/AuthGate";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider delayDuration={300}>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
