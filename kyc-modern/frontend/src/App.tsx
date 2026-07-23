import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useHeartbeat } from './hooks';
import { LoginPage, ChangePasswordPage } from './pages/AuthPages';
import { Topbar, Sidebar } from './components/layout/Shell';
import { LoadingCenter } from './components/ui';
import { AccueilPage } from './pages/AccueilPage';
import { AcquisitionPage } from './pages/AcquisitionPage';
import { FaceLivenessCheck } from './pages/FaceLivenessCheck';

// ── Agent pages ───────────────────────────────────────────────────────────────
import { AgentDashboard, AgentFileAttente, AgentMesDossiers, AgentAcquisition } from './pages/agent/DossierPages';
import { GsmMonTableau, GsmSaisie, GsmHistorique, GsmPerfs } from './pages/agent/GsmPages';
import { AgentPlanning, AgentNotesQualite } from './pages/agent/AutresPages';

// ── Superviseur pages ─────────────────────────────────────────────────────────
import {
  SupDashboard, SupFileAttente, SupHistorique, SupPresence,
  SupPerformance, SupDistribution, SupDonneesHeures, SupFlux,
  SupCompilationGsm, SupNotesQualite, SupPlanning, SupReporting,
} from './pages/sup/SupPages';
import { SupCapturesPage } from './pages/sup/CapturesPage';
import { SupPlanningManagersPage } from './pages/sup/PlanningManagersPage';

// ── Admin pages ───────────────────────────────────────────────────────────────
import {
  AdminDashboard, AdminComptes, AdminSessions, AdminAudit,
  AdminDistribution, AdminHabilitations, AdminReferentiels,
  AdminPurge, AdminStockage, AdminReporting,
} from './pages/admin/AdminPages';
import { AdminCapturesPage } from './pages/admin/CapturesPage';
import { AdminParametresPage } from './pages/admin/ParametresPage';

function getRoute(): string {
  const p = window.location.pathname.replace(/\/$/, '') || '/';
  return p;
}

function PublicRouter() {
  const route = getRoute();

  if (route === '/acquisition' || route === '/acquisition.html') return <AcquisitionPage />;
  if (route === '/liveness-check' || route === '/liveness-check.html') return <FaceLivenessCheck />;
  if (route === '/login') return null;

  return <AccueilPage />;
}

// ── Routing agent ─────────────────────────────────────────────────────────────
function AgentApp({ page }: { page: string }) {
  switch (page) {
    case 'file-attente':    return <AgentFileAttente />;
    case 'mes-dossiers':    return <AgentMesDossiers />;
    case 'gsm-saisie':      return <GsmSaisie />;
    case 'gsm-tableau':     return <GsmMonTableau />;
    case 'gsm-historique':  return <GsmHistorique />;
    case 'gsm-perfs':       return <GsmPerfs />;
    case 'planning':        return <AgentPlanning />;
    case 'qualite':         return <AgentNotesQualite />;
    case 'acquisition':     return <AgentAcquisition />;
    default:                return <AgentDashboard />;
  }
}

// ── Routing superviseur ───────────────────────────────────────────────────────
function SupApp({ page }: { page: string }) {
  switch (page) {
    case 'file-attente':      return <SupFileAttente />;
    case 'historique':        return <SupHistorique />;
    case 'presence':          return <SupPresence />;
    case 'performance':       return <SupPerformance />;
    case 'distribution':      return <SupDistribution />;
    case 'donnees-heures':    return <SupDonneesHeures />;
    case 'flux':              return <SupFlux />;
    case 'compilation-gsm':   return <SupCompilationGsm />;
    case 'notes-qualite':     return <SupNotesQualite />;
    case 'planning':          return <SupPlanning />;
    case 'planning-managers': return <SupPlanningManagersPage />;
    case 'captures':          return <SupCapturesPage />;
    case 'reporting':         return <SupReporting />;
    default:                  return <SupDashboard />;
  }
}

// ── Routing admin ─────────────────────────────────────────────────────────────
function AdminApp({ page }: { page: string }) {
  switch (page) {
    case 'comptes':        return <AdminComptes />;
    case 'sessions':       return <AdminSessions />;
    case 'audit':          return <AdminAudit />;
    case 'distribution':   return <AdminDistribution />;
    case 'habilitations':  return <AdminHabilitations />;
    case 'referentiels':   return <AdminReferentiels />;
    case 'stockage':       return <AdminStockage />;
    case 'purge':          return <AdminPurge />;
    case 'reporting':      return <AdminReporting />;
    case 'captures':       return <AdminCapturesPage />;
    case 'parametres':     return <AdminParametresPage />;
    default:               return <AdminDashboard />;
  }
}

// ── Shell authentifié ─────────────────────────────────────────────────────────
function AuthenticatedShell() {
  const { user } = useAuth();
  const [page, setPage] = useState('dashboard');

  // Synchroniser l'état page avec l'URL pathname
  useEffect(() => {
    const pathname = window.location.pathname.replace(/\/$/, '') || '/';
    const pageMap: Record<string, string> = {
      '/gsm-saisie': 'gsm-saisie',
      '/gsm-tableau': 'gsm-tableau',
      '/gsm-historique': 'gsm-historique',
      '/gsm-perfs': 'gsm-perfs',
      '/file-attente': 'file-attente',
      '/mes-dossiers': 'mes-dossiers',
      '/planning': 'planning',
      '/qualite': 'qualite',
      '/acquisition': 'acquisition',
    };
    if (pageMap[pathname]) {
      setPage(pageMap[pathname]);
    }
  }, []);

  // Heartbeat toutes les 60s pour les agents
  useHeartbeat(user?.role === 'agent', 60_000);

  if (!user) return null;
  if (user.must_change_password) return <ChangePasswordPage />;

  return (
    <div className="shell">
      <Topbar />
      <Sidebar role={user.role} active={page} onChange={setPage} />
      <main className="main">
        {user.role === 'agent'       && <AgentApp page={page} />}
        {user.role === 'superviseur' && <SupApp   page={page} />}
        {user.role === 'admin'       && <AdminApp page={page} />}
      </main>
    </div>
  );
}

// ── AppContent – décision auth vs public ──────────────────────────────────────
function AppContent() {
  const { user, loading } = useAuth();
  const [pathname, setPathname] = useState(() => getRoute());

  useEffect(() => {
    const handleRouteChange = () => setPathname(getRoute());
    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, []);

  const isPublicPage =
    pathname === '/' ||
    pathname === '/acquisition' ||
    pathname === '/acquisition.html' ||
    pathname === '/liveness-check' ||
    pathname === '/liveness-check.html';

  if (!user && isPublicPage) return <PublicRouter />;

  if (loading) {
    return (
      <div className="shell-auth">
        <LoadingCenter label="Chargement de la session…" />
      </div>
    );
  }

  if (pathname === '/login') {
    return user ? <AuthenticatedShell /> : <LoginPage />;
  }

  return user ? <AuthenticatedShell /> : <AccueilPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
