import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import LandingPage    from "./pages/LandingPage";
import TermsOfUsePage from "./pages/TermsOfUsePage";
import PrivacyPolicyPage from "./pages/PrivacyPolicyPage";
import DataSecurityPage from "./pages/DataSecurityPage";
import LoginPage      from "./pages/LoginPage";
import RegisterPage   from "./pages/RegisterPage";
import DashboardPage  from "./pages/DashboardPage";
import JobHuntPage    from "./pages/JobHuntPage";
import JobIntelPage   from "./pages/JobIntelPage";
import LinkLensPage   from "./pages/LinkLensPage";
import CVIntelPage    from "./pages/CVIntelPage";
import ResumeScreeningPage from "./pages/ResumeScreeningPage";
import PhoneInterviewPage  from "./pages/PhoneInterviewPage";
import VideoInterviewPage  from "./pages/VideoInterviewPage";
import FinalDecisionPage   from "./pages/FinalDecisionPage";
import JDCreatorPage  from "./pages/JDCreatorPage";
import PublicInterviewPage from "./pages/PublicInterviewPage";
import CareerApplyPage    from "./pages/CareerApplyPage";
import CandidatePortalPage from "./pages/CandidatePortalPage";
import RequisitionsPage    from "./pages/RequisitionsPage";
import HiringManagerViewPage from "./pages/HiringManagerViewPage";
import AcquisitionPage    from "./pages/AcquisitionPage";
import PlacementsPage     from "./pages/PlacementsPage";
import PortalsPage        from "./pages/PortalsPage";
import CommunicationPage  from "./pages/CommunicationPage";
import CommercialsPage    from "./pages/CommercialsPage";
import GovernancePage     from "./pages/GovernancePage";
import PublicClientPortalPage from "./pages/PublicClientPortalPage";
import PublicVendorPortalPage from "./pages/PublicVendorPortalPage";
import PublicInterviewSchedulePage from "./pages/PublicInterviewSchedulePage";
import PublicInterviewApprovalPage from "./pages/PublicInterviewApprovalPage";
import PublicInterviewFeedbackPage from "./pages/PublicInterviewFeedbackPage";
import ComingSoonPage     from "./pages/ComingSoonPage";
import SettingsPage   from "./pages/SettingsPage";
import AdminSetupPage from "./pages/AdminSetupPage";
import FileManagerPage from "./pages/FileManagerPage";
import AdminConsolePage from "./pages/AdminConsolePage";
import AppLayout      from "./components/layout/AppLayout";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="tiq-spinner-wrap"><div className="tiq-spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/terms" element={<TermsOfUsePage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/data-security" element={<DataSecurityPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/interview/:token" element={<PublicInterviewPage />} />
            <Route path="/careers/:slug" element={<CareerApplyPage />} />
            <Route path="/my-profile/:token" element={<CandidatePortalPage />} />
            <Route path="/hm/:token" element={<HiringManagerViewPage />} />
            <Route path="/schedule-interview/:token" element={<PublicInterviewSchedulePage />} />
            <Route path="/interview-approval/:token" element={<PublicInterviewApprovalPage />} />
            <Route path="/interview-feedback/:token" element={<PublicInterviewFeedbackPage />} />
            <Route path="/client-portal/:token" element={<PublicClientPortalPage />} />
            <Route path="/vendor-portal/:token" element={<PublicVendorPortalPage />} />
            <Route path="/app" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="jobhunt"    element={<JobHuntPage />} />
              <Route path="jobintel"   element={<JobIntelPage />} />
              <Route path="linklens"   element={<LinkLensPage />} />
              <Route path="cvintel"    element={<CVIntelPage />} />
              <Route path="jdcreator"  element={<JDCreatorPage />} />
              <Route path="resumescreening" element={<ResumeScreeningPage />} />
              <Route path="phoneinterview"  element={<PhoneInterviewPage />} />
              <Route path="videointerview"  element={<VideoInterviewPage />} />
              <Route path="finaldecision"   element={<FinalDecisionPage />} />
              <Route path="acquisition" element={<AcquisitionPage />} />
              <Route path="requisitions"  element={<RequisitionsPage />} />
              {/* interviews / pipeline kept as standalone routes for
                  anyone with them bookmarked or deep-linked — the
                  sidebar now points at placements instead, which has
                  both as tabs alongside the new Onboarding tab. */}
              {/* All three routes render the same PlacementsPage — see
                  that component and capabilities.ts's Phase 5 for why:
                  three separate sidebar entries, one shared page/tab
                  bar, so which one you land on tab-wise depends on
                  which sidebar link was actually clicked. */}
              <Route path="interviews"    element={<PlacementsPage />} />
              <Route path="pipeline"      element={<PlacementsPage />} />
              <Route path="onboarding"    element={<PlacementsPage />} />
              <Route path="placements"    element={<PlacementsPage />} />
              <Route path="portals"       element={<PortalsPage />} />
              <Route path="communication" element={<CommunicationPage />} />
              <Route path="commercials"   element={<CommercialsPage />} />
              <Route path="reporting"     element={<GovernancePage />} />
              <Route path="settings"   element={<SettingsPage />} />
              {/* admin-setup / file-manager kept as standalone routes for
                  anyone with them bookmarked or deep-linked — the
                  sidebar itself now points at admin-console instead,
                  which has both as tabs alongside Modules Management. */}
              <Route path="admin-setup"  element={<AdminRoute><AdminSetupPage /></AdminRoute>} />
              <Route path="file-manager" element={<AdminRoute><FileManagerPage /></AdminRoute>} />
              <Route path="admin-console" element={<AdminRoute><AdminConsolePage /></AdminRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}