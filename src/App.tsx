import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./components/AppLayout";
import Index from "./pages/Index";
import AgentsPage from "./pages/AgentsPage";
import ActivityPage from "./pages/ActivityPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import FailuresPage from "./pages/FailuresPage";
import ReplayPage from "./pages/ReplayPage";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/failures" element={<FailuresPage />} />
            <Route path="/replay" element={<ReplayPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
