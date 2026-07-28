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
import { AgentVideoCallPage } from './pages/agent/VideoCallPage';
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

function getPageForRoute(pathname: string): string | null {
  const route = pathname.replace(/\/$/, '') || '/';
  const pageMap: Record<string, string> = {
    '/gsm-saisie': 'gsm-saisie',
    '/gsm-tableau': 'gsm-tableau',
    '/gsm-historique': 'gsm-historique',
    '/gsm-perfs': 'gsm-perfs',
    '/file-attente': 'file-attente',
    '/mes-dossiers': 'mes-dossiers',
    '/video-call': 'video-call',
    '/planning': 'planning',
    '/qualite': 'qualite',
    '/acquisition': 'acquisition',
  };
  return pageMap[route] ?? null;
}

function getPathForPage(page: string): string {
  switch (page) {
    case 'gsm-saisie': return '/gsm-saisie';
    case 'gsm-tableau': return '/gsm-tableau';
    case 'gsm-historique': return '/gsm-historique';
    case 'gsm-perfs': return '/gsm-perfs';
    case 'file-attente': return '/file-attente';
    case 'mes-dossiers': return '/mes-dossiers';
    case 'video-call': return '/video-call';
    case 'planning': return '/planning';
    case 'qualite': return '/qualite';
    case 'acquisition': return '/acquisition';
    case 'dashboard':
    default: return '/';
  }
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
    case 'video-call':      return <AgentVideoCallPage />;
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

  const navigateToPage = (nextPage: string) => {
    const path = getPathForPage(nextPage);
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    if (currentPath !== path) {
      window.history.pushState({}, '', path);
    }
    setPage(nextPage);
  };

  // Synchroniser l'état page avec l'URL pathname, y compris après pushState/replaceState
  useEffect(() => {
    const syncPageFromUrl = () => {
      const nextPage = getPageForRoute(window.location.pathname);
      if (nextPage && nextPage !== page) {
        setPage(nextPage);
      } else if (!nextPage && page !== 'dashboard') {
        setPage('dashboard');
      }
    };

    syncPageFromUrl();

    const handleRouteChange = () => syncPageFromUrl();
    window.addEventListener('popstate', handleRouteChange);

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    window.history.pushState = ((...args: Parameters<typeof window.history.pushState>) => {
      const result = originalPushState(...args);
      handleRouteChange();
      return result;
    }) as typeof window.history.pushState;

    window.history.replaceState = ((...args: Parameters<typeof window.history.replaceState>) => {
      const result = originalReplaceState(...args);
      handleRouteChange();
      return result;
    }) as typeof window.history.replaceState;

    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [page]);

  // Heartbeat toutes les 60s pour les agents
  useHeartbeat(user?.role === 'agent', 60_000);

  if (!user) return null;
  if (user.must_change_password) return <ChangePasswordPage />;

  return (
    <div className="shell">
      <Topbar />
      <Sidebar role={user.role} active={page} onChange={navigateToPage} />
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
