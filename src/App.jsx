import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, BookOpen, Check, ChevronDown, Cloud, Download,
  ExternalLink, LayoutDashboard, LoaderCircle, RefreshCw, Search, Server, X,
  ShieldCheck, Trophy, Container, Tags, Workflow, Bell, Moon, Sun,
} from 'lucide-react';

const SpendChart = lazy(() => import('./SpendChart.jsx'));
const InventoryCharts = lazy(() => import('./SpendChart.jsx').then((module) => ({ default: module.InventoryCharts })));

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', label: 'Resource inventory', icon: Server },
  { id: 'containers', label: 'Containers & ECR', icon: Container },
  { id: 'devops', label: 'DevOps & governance', icon: Workflow },
  { id: 'learn', label: 'FinOps learning guide', icon: BookOpen },
];

const regionGroups = [
  { label: 'United States', prefixes: ['us-'] },
  { label: 'Asia Pacific', prefixes: ['ap-'] },
  { label: 'Europe', prefixes: ['eu-'] },
  { label: 'Americas', prefixes: ['sa-', 'ca-'] },
  { label: 'Middle East / Africa', prefixes: ['me-', 'af-', 'il-'] },
  { label: 'Other AWS Regions', prefixes: [] },
];

const regionLabels = {
  'af-south-1': 'Cape Town',
  'ap-east-1': 'Hong Kong',
  'ap-east-2': 'Taipei',
  'ap-northeast-1': 'Tokyo',
  'ap-northeast-2': 'Seoul',
  'ap-northeast-3': 'Osaka',
  'ap-south-1': 'Mumbai',
  'ap-south-2': 'Hyderabad',
  'ap-southeast-1': 'Singapore',
  'ap-southeast-2': 'Sydney',
  'ap-southeast-3': 'Jakarta',
  'ap-southeast-4': 'Melbourne',
  'ap-southeast-5': 'Malaysia',
  'ap-southeast-7': 'Thailand',
  'ca-central-1': 'Canada (Central)',
  'ca-west-1': 'Calgary',
  'eu-central-1': 'Frankfurt',
  'eu-central-2': 'Zurich',
  'eu-north-1': 'Stockholm',
  'eu-south-1': 'Milan',
  'eu-south-2': 'Spain',
  'eu-west-1': 'Ireland',
  'eu-west-2': 'London',
  'eu-west-3': 'Paris',
  'il-central-1': 'Tel Aviv',
  'me-central-1': 'UAE',
  'me-south-1': 'Bahrain',
  'sa-east-1': 'São Paulo',
  'us-east-1': 'N. Virginia',
  'us-east-2': 'Ohio',
  'us-west-1': 'N. California',
  'us-west-2': 'Oregon',
};

function regionDisplayName(region) {
  const location = regionLabels[region.id] || (region.name !== region.id ? region.name : '');
  return location ? `${location} (${region.id})` : region.id;
}

function getRegionGroups(regions) {
  const assigned = new Set();
  const groups = regionGroups.map((group) => {
    const matches = regions.filter((region) => (
      group.prefixes.length > 0 && group.prefixes.some((prefix) => region.id.startsWith(prefix))
    ));
    matches.forEach((region) => assigned.add(region.id));
    return { ...group, regions: matches };
  });
  const otherRegions = regions.filter((region) => !assigned.has(region.id));
  groups.find((group) => group.label === 'Other AWS Regions').regions = otherRegions;
  return groups.filter((group) => group.regions.length > 0);
}


const learningLessons = [
  {
    id: 'read-the-bill',
    title: 'Read your AWS bill',
    description: 'Use the account’s actual Cost Explorer history to identify spending patterns before proposing changes.',
    skill: 'Cost visibility',
    document: 'https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html',
    documentLabel: 'AWS Cost Explorer guide',
  },
  {
    id: 'investigate-idle',
    title: 'Investigate idle resources',
    description: 'Treat unattached resources as investigation leads. Verify ownership, dependencies, retention, and recovery needs.',
    skill: 'Waste identification',
    document: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ebs-detaching-volume.html',
    documentLabel: 'AWS EBS volume guide',
  },
  {
    id: 'allocate-costs',
    title: 'Make costs accountable',
    description: 'Use consistent tags and cost allocation practices to connect spend with the teams and workloads that own it.',
    skill: 'Allocation & tagging',
    document: 'https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html',
    documentLabel: 'AWS cost allocation tags',
  },
  {
    id: 'safe-change',
    title: 'Plan a safe change',
    description: 'Before any manual change, record the owner, customer impact, approval, backup or retention checks, and rollback plan.',
    skill: 'Governance & action',
    document: 'https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html',
    documentLabel: 'AWS Well-Architected Cost Optimization',
  },
  {
    id: 'billing-alerts',
    title: 'Set up billing alerts',
    description: 'Use an approved budget and billing notifications to detect unexpected spend early and give owners time to respond.',
    skill: 'Budgeting & monitoring',
    document: 'https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html',
    documentLabel: 'AWS Budgets guide',
    video: 'https://youtu.be/_qf7IuZ1vYs?si=bxl9jNbZN-yNEAVr',
    videoLabel: 'Watch: Setting up AWS budget alerts',
  },
];

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }
  return data;
}

function formatMoney(amount, currency) {
  if (amount == null || !currency) return 'Unavailable';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

// ---- Light / dark theme -------------------------------------------------------------------
// Dark mode inverts the rendered page (and flips hues back), then restores images and the logo.
// It works with any stylesheet, so no individual colour has to be redefined.
const THEME_KEY = 'finops-theme';
const THEME_CSS = `
html[data-theme="dark"] { filter: invert(0.93) hue-rotate(180deg); background: #ffffff; }
html[data-theme="dark"] img,
html[data-theme="dark"] video,
html[data-theme="dark"] canvas,
html[data-theme="dark"] iframe,
html[data-theme="dark"] .brand-mark { filter: invert(1) hue-rotate(180deg); }
`;

function readTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage can be blocked; fall through */ }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* per-visit only */ }
  };
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return <button type="button" className="secondary-button theme-toggle" onClick={toggle} aria-label={label} title={label}>
    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    {theme === 'dark' ? 'Light' : 'Dark'}
  </button>;
}

function App() {
  const [page, setPage] = useState('overview');
  const [account, setAccount] = useState(null);
  const [regionData, setRegionData] = useState([]);
  const [region, setRegion] = useState('');
  const [scan, setScan] = useState(null);
  const [costs, setCosts] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [regionError, setRegionError] = useState('');
  const [scanError, setScanError] = useState('');
  const [costError, setCostError] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [costLoading, setCostLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [inventoryQuickFilter, setInventoryQuickFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [learningProgress, setLearningProgress] = useState(null);
  const [openLesson, setOpenLesson] = useState(learningLessons[0].id);
  const [cloudOps, setCloudOps] = useState({});
  const [moduleErrors, setModuleErrors] = useState({});
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleAction, setModuleAction] = useState('');
  const [moduleResults, setModuleResults] = useState({});
  const [parkingEnvironment, setParkingEnvironment] = useState('Dev');
  const [parkingEnabled, setParkingEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSettingsOpen, setWebhookSettingsOpen] = useState(false);
  const [connection, setConnection] = useState({ connected: false, role_arn: '', server_account_enabled: true, loaded: false });
  const [connectRequest, setConnectRequest] = useState(0);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    fetch('/api/health').then((response) => (response.ok ? response.json() : null)).then((data) => setAppVersion(data?.version || '')).catch(() => {});
  }, []);
  // Open-to-everyone mode: nothing is shown (and nothing is requested) until the visitor connects their own account.
  const needsConnection = connection.loaded && !connection.connected && !connection.server_account_enabled;
  const moduleRegion = region === 'all'
    ? account?.region || regionData[0]?.id || ''
    : region;

  const loadAccount = useCallback(async () => {
    setAccountError('');
    try {
      setAccount(await requestJson('/api/aws/account'));
    } catch (error) {
      setAccount(null);
      setAccountError(error.message);
    }
  }, []);

  const loadCosts = useCallback(async () => {
    setCostLoading(true);
    setCostError('');
    try {
      setCosts(await requestJson('/api/aws/costs'));
    } catch (error) {
      setCosts(null);
      setCostError(error.message);
    } finally {
      setCostLoading(false);
    }
  }, []);

  const runScan = useCallback(async (selectedRegion) => {
    if (!selectedRegion) return;
    const normalizedRegion = String(selectedRegion).trim();
    if (!normalizedRegion) return;
    setScanLoading(true);
    setScanError('');
    try {
      const result = await requestJson(`/api/aws/scan?region=${encodeURIComponent(normalizedRegion)}`);
      setScan(result);
      setScanError('');
    } catch (error) {
      setScan(null);
      setScanError(error.message);
    } finally {
      setScanLoading(false);
    }
  }, []);

  const loadCloudOps = useCallback(async () => {
    if (!moduleRegion) return;
    setModuleLoading(true);
    setCloudOps({});
    setModuleErrors({});
    setModuleResults({});
    const endpoints = {
      kubernetes: `/api/k8s/inventory?region=${encodeURIComponent(moduleRegion)}`,
      ecr: `/api/ecr/audit?region=${encodeURIComponent(moduleRegion)}`,
      tags: `/api/governance/tags?region=${encodeURIComponent(moduleRegion)}`,
      webhooks: '/api/webhooks/config',
      alerts: '/api/webhooks/alerts',
    };
    const nextErrors = {};
    await Promise.all(Object.entries(endpoints).map(async ([key, endpoint]) => {
      try {
        const data = await requestJson(endpoint);
        setCloudOps((current) => ({ ...current, [key]: data }));
      } catch (error) {
        nextErrors[key] = error.message;
        setCloudOps((current) => ({ ...current, [key]: null }));
      }
    }));
    setModuleErrors(nextErrors);
    setModuleLoading(false);
  }, [moduleRegion]);

  const postModuleAction = useCallback(async (action, path, payload) => {
    setModuleAction(action);
    setModuleErrors((current) => ({ ...current, [action]: '' }));
    try {
      const result = await requestJson(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setModuleResults((current) => ({ ...current, [action]: result }));
      if (action === 'webhook-test') {
        setWebhookUrl('');
      }
      if (action === 'tag-alert') {
        setModuleResults((current) => ({ ...current, [action]: result }));
      }
      return result;
    } catch (error) {
      setModuleErrors((current) => ({ ...current, [action]: error.message }));
      return null;
    } finally {
      setModuleAction('');
    }
  }, []);

  const loadModuleAlerts = useCallback(async () => {
    try {
      const alerts = await requestJson('/api/webhooks/alerts');
      setCloudOps((current) => ({ ...current, alerts }));
    } catch (error) {
      setModuleErrors((current) => ({ ...current, alerts: error.message }));
    }
  }, []);

  useEffect(() => {
    if (page === 'devops' || page === 'containers') void loadCloudOps();
  }, [page, loadCloudOps]);

  useEffect(() => {
    if (page !== 'devops' && page !== 'containers') return undefined;
    const timer = window.setInterval(loadModuleAlerts, 15000);
    return () => window.clearInterval(timer);
  }, [page, loadModuleAlerts]);

  const handleRegionChange = useCallback((nextRegion) => {
    const normalizedRegion = String(nextRegion || '').trim();
    setRegion(normalizedRegion);
    if (normalizedRegion) {
      void runScan(normalizedRegion);
    }
  }, [runScan]);

  const loadAll = useCallback(async () => {
    setScan(null);
    setRegionError('');
    loadAccount();
    loadCosts();
    try {
      const data = await requestJson('/api/aws/regions');
      const nextRegions = data.regions || [];
      const configured = data.configured_region || nextRegions[0]?.id || '';
      setRegionData(nextRegions);
      setRegion(configured);
      if (configured) runScan(configured);
    } catch (error) {
      setRegionError(error.message);
    }
  }, [loadAccount, loadCosts, runScan]);

  useEffect(() => {
    requestJson('/api/connect/status')
      .then((status) => {
        setConnection({ ...status, loaded: true });
        if (status.connected || status.server_account_enabled) loadAll();
      })
      .catch(() => {
        setConnection((current) => ({ ...current, loaded: true }));
        loadAll();
      });
  }, [loadAll]);

  const handleConnected = (info) => {
    setConnection((current) => ({ ...current, connected: true, role_arn: info.role_arn, loaded: true }));
    setCloudOps({});
    loadAll();
    setToast(`Connected to AWS account ${info.account_id}.`);
    window.setTimeout(() => setToast(''), 3000);
  };

  const disconnect = async () => {
    await requestJson('/api/connect/disconnect', { method: 'POST' }).catch(() => {});
    setConnection((current) => ({ ...current, connected: false, role_arn: '' }));
    setToast('');
    setCloudOps({});
    if (connection.server_account_enabled) {
      loadAll();
      return;
    }
    // Nothing from the account that was just disconnected may stay on screen.
    setAccount(null); setCosts(null); setScan(null); setRegionData([]); setRegion('');
    setAccountError(''); setCostError(''); setScanError(''); setRegionError('');
    setModuleErrors({}); setModuleResults({});
  };

  useEffect(() => {
    if (!account?.account_id) return;
    const key = `finops-learning-progress:${account.account_id}`;
    try {
      const stored = window.localStorage.getItem(key);
      const parsed = stored ? JSON.parse(stored) : [];
      const validIds = Array.isArray(parsed)
        ? parsed.filter((id) => learningLessons.some((lesson) => lesson.id === id))
        : [];
      setLearningProgress({ accountId: account.account_id, completed: validIds });
    } catch {
      setLearningProgress({ accountId: account.account_id, completed: [] });
      setToast('Learning progress could not be loaded from this browser.');
      window.setTimeout(() => setToast(''), 3000);
    }
  }, [account?.account_id]);

  useEffect(() => {
    if (!learningProgress || learningProgress.accountId !== account?.account_id) return;
    try {
      window.localStorage.setItem(
        `finops-learning-progress:${learningProgress.accountId}`,
        JSON.stringify(learningProgress.completed),
      );
    } catch {
      setToast('Progress is updated for this session but could not be saved in this browser.');
      window.setTimeout(() => setToast(''), 3000);
    }
  }, [learningProgress, account?.account_id]);

  const visibleResources = useMemo(() => (scan?.resources || []).filter((resource) => {
    const state = resource.state || resource.status || '';
    const matchesQuery = `${resource.name} ${resource.id} ${resource.type} ${resource.service} ${resource.category} ${resource.region} ${state}`.toLowerCase().includes(query.toLowerCase());
    const matchesType = typeFilter === 'all' || resource.type === typeFilter;
    const service = resource.service || '';
    const matchesQuickFilter = inventoryQuickFilter === 'all'
      || (inventoryQuickFilter === 'storage' && ['S3', 'EBS', 'EFS'].includes(service))
      || (inventoryQuickFilter === 'database' && ['RDS', 'DynamoDB', 'ElastiCache', 'Redshift'].includes(service))
      || (inventoryQuickFilter === 'serverless' && ['Lambda', 'API Gateway', 'SQS', 'SNS'].includes(service))
      || (inventoryQuickFilter === 'networking' && (
        ['VPC', 'Elastic Load Balancing', 'CloudFront'].includes(service)
        || resource.category === 'Networking'
      ));
    return matchesQuery && matchesType && matchesQuickFilter;
  }), [scan, query, typeFilter, inventoryQuickFilter]);

  const exportCsv = () => {
    if (!visibleResources.length) return;
    const rows = [
      ['Resource ID', 'Name', 'Service', 'Category', 'Type', 'Region', 'State', 'Waste candidate', 'Estimated monthly cost', 'Details'],
      ...visibleResources.map((resource) => [
        resource.id, resource.name, resource.service, resource.category, resource.type,
        resource.region, resource.state, resource.is_waste_candidate,
        resource.estimated_monthly_cost ?? '', resource.details,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = `aws-inventory-${scan.region}-${scan.scanned_at}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setToast('Current AWS inventory exported.');
    window.setTimeout(() => setToast(''), 3000);
  };

  const latestCost = costs?.monthly?.at(-1);
  const latestCostLabel = latestCost
    ? new Date(`${latestCost.month}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : 'Last six complete months';
  const availableTypes = [...new Set((scan?.resources || []).map((resource) => resource.type))];
  const pageTitle = navigation.find((item) => item.id === page)?.label || 'Overview';

  return <div className="app-shell">
    <style>{THEME_CSS}</style>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="FinOps-Bharat home">
        <span className="brand-mark"><Cloud size={20} /></span>
        <span className="brand-name">finops<span>bharat</span><small>Live AWS operations</small></span>
      </a>
      <div className="workspace-label">AWS ACCOUNT</div>
      <div className="workspace-select account-identity" aria-live="polite">
        <span className="workspace-avatar"><Cloud size={16} /></span>
        <span className="workspace-copy">
          <strong>{account ? `Account ${account.account_id}` : needsConnection ? 'Not connected' : 'AWS account unavailable'}</strong>
          <small>{account ? (region === 'all' ? 'All regions' : (region || account.region)) : needsConnection ? 'Connect your AWS account' : accountError || 'Checking server identity…'}</small>
        </span>
      </div>
      <div className="nav-label">CLOUD</div>
      <nav className="main-nav" aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button className={`nav-item ${page === id ? 'nav-active' : ''}`} key={id} onClick={() => setPage(id)}>
            <Icon size={18} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="note-icon"><ShieldCheck size={17} /></span><div><strong>Read-only integration</strong><p>Scans describe resources and never change them.</p></div></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb"><span>AWS</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div>
        <div className="topbar-right">
          {account && <span className="account-badge"><span /> LIVE · {account.account_id}</span>}
          <ThemeToggle />
          <ConnectAwsButton
            connected={connection.connected}
            onConnected={handleConnected}
            onDisconnect={disconnect}
            openRequest={connectRequest}
          />
          <button className="connect-button" disabled={scanLoading || !region} onClick={() => runScan(region)}>
            {scanLoading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            {scanLoading ? 'Scanning AWS' : 'Refresh inventory'}
          </button>
        </div>
      </header>

      {needsConnection && <ConnectWelcome onConnect={() => setConnectRequest((n) => n + 1)} />}
      {!needsConnection && page === 'overview' && <Overview
        account={account}
        accountError={accountError}
        costs={costs}
        costError={costError}
        costLoading={costLoading}
        latestCost={latestCost}
        latestCostLabel={latestCostLabel}
        scan={scan}
        scanError={scanError}
        scanLoading={scanLoading}
        region={region}
        regionData={regionData}
        onRegionChange={handleRegionChange}
        regionError={regionError}
        onOpenInventory={() => setPage('inventory')}
        onScan={() => runScan(region)}
        onRetryAccount={loadAccount}
        onRetryCosts={loadCosts}
      />}
      {!needsConnection && page === 'inventory' && <Inventory
        account={account}
        resources={visibleResources}
        allResources={scan?.resources || []}
        totalResources={scan?.resource_count || 0}
        inventoryQuickFilter={inventoryQuickFilter}
        setInventoryQuickFilter={setInventoryQuickFilter}
        query={query}
        setQuery={setQuery}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        availableTypes={availableTypes}
        region={moduleRegion}
        regionData={regionData}
        scan={scan}
        scanError={scanError}
        scanLoading={scanLoading}
        regionError={regionError}
        onRegionChange={handleRegionChange}
        onScan={() => runScan(region)}
        onExport={exportCsv}
      />}
      {!needsConnection && page === 'devops' && <DevOpsGovernance
        region={region}
        cloudOps={cloudOps}
        errors={moduleErrors}
        loading={moduleLoading}
        action={moduleAction}
        results={moduleResults}
        parkingEnvironment={parkingEnvironment}
        setParkingEnvironment={setParkingEnvironment}
        parkingEnabled={parkingEnabled}
        setParkingEnabled={setParkingEnabled}
        webhookUrl={webhookUrl}
        setWebhookUrl={setWebhookUrl}
        webhookSettingsOpen={webhookSettingsOpen}
        setWebhookSettingsOpen={setWebhookSettingsOpen}
        onRefresh={loadCloudOps}
        onParkingPlan={() => postModuleAction('parking-plan', '/api/governance/park-schedule', {
          region: moduleRegion,
          environment: parkingEnvironment,
          enabled: parkingEnabled,
        })}
        onTagAlert={() => postModuleAction('tag-alert', '/api/governance/tags/notify', { region: moduleRegion })}
        onWebhookTest={() => postModuleAction('webhook-test', '/api/webhooks/trigger', { destination_url: webhookUrl })}
        onPlanEcrCleanup={() => postModuleAction('ecr-cleanup-plan', '/api/ecr/cleanup', {
          region: moduleRegion,
          images: (cloudOps.ecr?.stale_images || []).slice(0, 100).map((image) => ({
            repository: image.repository,
            digest: image.digest,
          })),
        })}
      />}
      {!needsConnection && page === 'containers' && <ContainersPage
        region={moduleRegion}
        kubernetes={cloudOps.kubernetes}
        ecr={cloudOps.ecr}
        errors={moduleErrors}
        loading={moduleLoading}
        action={moduleAction}
        results={moduleResults}
        onRefresh={loadCloudOps}
        onPlanEcrCleanup={() => postModuleAction('ecr-cleanup-plan', '/api/ecr/cleanup', {
          region: moduleRegion,
          images: (cloudOps.ecr?.stale_images || []).slice(0, 100).map((image) => ({
            repository: image.repository,
            digest: image.digest,
          })),
        })}
      />}
      {!needsConnection && page === 'learn' && <LearningGuide
        account={account}
        costs={costs}
        resources={scan?.resources || []}
        region={region}
        lessons={learningLessons}
        openLesson={openLesson}
        setOpenLesson={setOpenLesson}
        completedLessons={learningProgress?.accountId === account?.account_id ? learningProgress.completed : []}
        onToggleComplete={(lessonId) => {
          setLearningProgress((current) => {
            const completed = current?.accountId === account?.account_id ? current.completed : [];
            return {
              accountId: account?.account_id || '',
              completed: completed.includes(lessonId)
                ? completed.filter((id) => id !== lessonId)
                : [...completed, lessonId],
            };
          });
        }}
        onOpenInventory={() => setPage('inventory')}
        onOpenOverview={() => setPage('overview')}
      />}
      <footer className="footer"><span>FinOps-Bharat</span><span>Live AWS, GitHub & webhook integrations · review-only AWS actions{appVersion ? ` · version ${appVersion}` : ''}</span></footer>
    </main>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </div>;
}

function DevOpsGovernance({
  region, cloudOps, errors, loading, action, results,
  parkingEnvironment, setParkingEnvironment, parkingEnabled, setParkingEnabled,
  webhookUrl, setWebhookUrl, webhookSettingsOpen, setWebhookSettingsOpen,
  onRefresh, onParkingPlan,
  onTagAlert, onWebhookTest, onPlanEcrCleanup,
}) {
  const tagAudit = cloudOps.tags;
  const alerts = cloudOps.alerts?.alerts || [];
  return <div className="page-wrap devops-page">
    <PageHeading
      eyebrow="CLOUD GOVERNANCE / LIVE INTEGRATIONS"
      title="DevOps, cost and governance"
      description="Live AWS and GitHub data. All AWS actions on this page generate review plans only; they do not change cloud resources."
      action={<button className="secondary-button" disabled={loading} onClick={onRefresh}><RefreshCw size={15} />{loading ? 'Refreshing…' : `Refresh ${region || 'AWS'}`}</button>}
    />

    <section className="governance-grid">
      <article className="panel governance-card">
        <div className="panel-heading"><div><h2><Tags size={16} /> Tagging & auto-parking governance</h2><p>Required tags: Owner, Environment, CostCenter</p></div></div>
        <ErrorPanel message={errors.tags || errors['tag-alert'] || errors['parking-plan']} />
        <div className="tag-compliance">
          <strong>{tagAudit?.compliance_percent == null ? '—' : `${tagAudit.compliance_percent}%`}</strong>
          <span>{tagAudit ? `${tagAudit.compliant_count} of ${tagAudit.resource_count} resources compliant` : loading ? 'Loading AWS tag audit…' : 'Live audit unavailable'}</span>
          {tagAudit && <progress value={tagAudit.compliance_percent || 0} max="100" aria-label="AWS tag compliance percentage" />}
        </div>
        {tagAudit?.resources?.filter((item) => item.missing_tags.length).slice(0, 8).map((item) => <p className="module-note" key={item.id}>{item.type} · {item.id}: missing {item.missing_tags.join(', ')}</p>)}
        {tagAudit && !tagAudit.resource_count && <p className="module-note">No resources were returned for this tag audit.</p>}
        <button className="secondary-button" disabled={!tagAudit || Boolean(action)} onClick={onTagAlert}>{action === 'tag-alert' ? 'Sending…' : 'Send tag violation alert'}</button>
        {results['tag-alert'] && <p className="module-result" role="status">{results['tag-alert'].message}</p>}
        <form className="parking-controls" onSubmit={(event) => { event.preventDefault(); onParkingPlan(); }}>
          <label>Environment <select value={parkingEnvironment} onChange={(event) => setParkingEnvironment(event.target.value)}><option>Dev</option><option>Staging</option></select></label>
          <label className="parking-toggle"><input type="checkbox" checked={parkingEnabled} onChange={(event) => setParkingEnabled(event.target.checked)} /> Include in schedule proposal</label>
          <button className="secondary-button" type="submit" disabled={Boolean(action)}>{action === 'parking-plan' ? 'Scanning resources…' : 'Preview 8 PM / 8 AM IST schedule'}</button>
        </form>
        {results['parking-plan'] && <p className="module-result" role="status">{results['parking-plan'].matched_resources.length} tagged resource(s) matched. Proposal only; no EventBridge, Lambda, EC2, or RDS changes were made.</p>}
      </article>

      <article className="panel governance-card">
        <div className="panel-heading">
          <div><h2><Bell size={16} /> Cost anomaly alerts</h2><p>Signed AWS SNS events · Slack/Teams delivery</p></div>
          <button className="secondary-button" onClick={() => setWebhookSettingsOpen(true)}>Webhook settings</button>
        </div>
        <ErrorPanel message={errors.webhooks || errors.alerts} />
        <p className="module-note">Configured server destinations: {(cloudOps.webhooks?.destinations || []).map((item) => item.name).join(', ') || 'none'}.</p>
        <p className="module-note">User-entered webhook URLs are sent to the API only for a test and are not persisted. Server-side SNS destinations use deployment environment variables.</p>
        <div className="alert-feed">
          {alerts.map((item) => <article key={item.message_id || item.received_at}>
            <strong>{item.subject || 'AWS Cost Anomaly Detection'}</strong>
            <small>{item.received_at}</small>
            <pre>{typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail, null, 2)}</pre>
            {item.dispatch_error && <span className="alert-dispatch-error">Delivery error: {item.dispatch_error}</span>}
          </article>)}
          {!alerts.length && <p className="module-empty">No signed SNS notifications received by this API process yet.</p>}
        </div>
      </article>
    </section>

    {webhookSettingsOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWebhookSettingsOpen(false); }}>
      <section className="webhook-modal panel" role="dialog" aria-modal="true" aria-labelledby="webhook-settings-title">
        <div className="panel-heading"><div><h2 id="webhook-settings-title">Test a Slack or Teams webhook</h2><p>URL is held in this page’s memory only and sent over HTTPS for this test.</p></div>
          <button className="icon-button" aria-label="Close webhook settings" onClick={() => setWebhookSettingsOpen(false)}><X size={17} /></button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); onWebhookTest(); }}>
          <label>Incoming webhook URL<input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://hooks.slack.com/services/…" required autoComplete="off" /></label>
          <p className="module-note">Only HTTPS Slack and Microsoft Teams webhook domains are accepted. Never paste AWS credentials here.</p>
          <ErrorPanel message={errors['webhook-test']} />
          {results['webhook-test'] && <p className="module-result" role="status">Test delivered to {results['webhook-test'].destination}.</p>}
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setWebhookSettingsOpen(false)}>Close</button><button className="primary-button" type="submit" disabled={!webhookUrl || Boolean(action)}>{action === 'webhook-test' ? 'Sending test…' : 'Send test message'}</button></div>
        </form>
      </section>
    </div>}
  </div>;
}

function ContainersPage({ region, kubernetes, ecr, errors, loading, action, results, onRefresh, onPlanEcrCleanup }) {
  return <div className="page-wrap devops-page">
    <PageHeading
      eyebrow="AWS CONTAINERS / LIVE METRICS"
      title="Containers & ECR"
      description="Live EKS cluster, Container Insights utilization, and ECR image inventory for the selected AWS region."
      action={<button className="secondary-button" disabled={loading} onClick={onRefresh}><RefreshCw size={15} />{loading ? 'Refreshing…' : 'Refresh live data'}</button>}
    />
    <div className="governance-grid">
      <ContainersEcrPanel kubernetes={kubernetes} ecr={ecr} errors={errors} loading={loading} region={region} action={action} results={results} onPlanEcrCleanup={onPlanEcrCleanup} />
    </div>
  </div>;
}

function ContainersEcrPanel({ kubernetes, ecr, errors, loading, region, action, results, onPlanEcrCleanup }) {
  const clusters = kubernetes?.clusters || [];
  return <article className="panel governance-card governance-wide">
    <div className="panel-heading"><div><h2><Container size={16} /> EKS cluster utilization</h2><p>Active clusters and live Container Insights CloudWatch metrics · {region}</p></div></div>
    <ErrorPanel message={errors.kubernetes} />
    {clusters.map((cluster) => <section className="cluster-card" key={cluster.name}>
      <strong>{cluster.name} <span className="status-tag">{cluster.status || 'status unavailable'}</span></strong>
      <small>EKS {cluster.version || 'version unavailable'} · {cluster.nodegroups.length} node group(s)</small>
      {cluster.warnings.map((warning) => <p className="module-note" key={warning}>{warning}</p>)}
      <div className="metric-series-list">{cluster.container_insights_metrics.map((metric, index) => <div key={`${metric.metric}-${index}`}>
        <span>{metric.metric}</span><strong>{metric.latest_value == null ? 'No datapoint' : `${Number(metric.latest_value).toFixed(2)}%`}</strong>
        <small>{Object.values(metric.dimensions).join(' · ')}</small>
      </div>)}</div>
      {cluster.nodegroups.map((group) => <p className="module-note" key={group.name}>{group.name}: {group.desired_size ?? 'unknown'} desired · {group.instance_types.join(', ') || 'instance type unavailable'}</p>)}
    </section>)}
    {kubernetes && !clusters.length && <p className="module-empty">No EKS clusters were returned by AWS.</p>}
    {!kubernetes && loading && <EmptyPanel loading message="Loading live EKS and CloudWatch metrics…" />}
    {!kubernetes && !loading && !errors.kubernetes && <p className="module-empty">EKS inventory has not been loaded.</p>}
    <div className="panel-heading ecr-heading"><div><h3><Container size={15} /> Amazon ECR image audit</h3><p>Live repository metadata · stale threshold 60 days</p></div></div>
    <ErrorPanel message={errors.ecr} />
    {ecr && <>
      <div className="module-stat"><strong>{ecr.stale_images.length}</strong><span>stale · {ecr.untagged_images.length} untagged · {ecr.duplicate_digests.length} duplicate digest group(s)</span></div>
      <p className="module-note">{ecr.indicative_monthly_storage_cost?.amount == null
        ? 'ECR cost allocation unavailable: Cost Explorer returned no matching actual ECR spend.'
        : `Indicative storage allocation: ${formatMoney(ecr.indicative_monthly_storage_cost.amount, ecr.indicative_monthly_storage_cost.currency)} based on actual account spend; not an avoidable-cost estimate.`}</p>
      <p className="module-note">{ecr.cost_note}</p>
      <button className="secondary-button" disabled={!ecr.stale_images.length || Boolean(action)} onClick={onPlanEcrCleanup}>
        {action === 'ecr-cleanup-plan' ? 'Verifying live image candidates…' : `Review stale image cleanup plan (${ecr.stale_images.length})`}
      </button>
      <ErrorPanel message={errors['ecr-cleanup-plan']} />
      {results['ecr-cleanup-plan'] && <p className="module-result" role="status">{results['ecr-cleanup-plan'].eligible_images.length} live image(s) eligible for owner review. No ECR images were deleted.</p>}
    </>}
    {!ecr && loading && <EmptyPanel loading message="Scanning live ECR image manifests and Cost Explorer…" />}
    {!ecr && !loading && !errors.ecr && <p className="module-empty">ECR inventory has not been loaded.</p>}
  </article>;
}

function ErrorPanel({ message, onRetry }) {
  if (!message) return null;
  return <div className="live-error" role="alert"><AlertCircle size={17} /><span>{message}</span>{onRetry && <button onClick={onRetry}>Retry</button>}</div>;
}

// Visitors may type just their 12-digit AWS account ID; the role name is fixed, so the ARN can be built.
function toRoleArn(value, roleName = 'FinOpsBharatReadOnly') {
  const trimmed = String(value || '').trim();
  return /^\d{12}$/.test(trimmed) ? `arn:aws:iam::${trimmed}:role/${roleName}` : trimmed;
}

function ConnectWelcome({ onConnect }) {
  return <div className="page-wrap">
    <PageHeading
      eyebrow="WELCOME"
      title="Connect your AWS account to begin."
      description="FinOps-Bharat scans your own AWS account through a read-only IAM role that you create. No access keys are shared, and nothing in your account is ever changed."
      action={<button className="primary-button" onClick={onConnect}><Cloud size={16} /> Connect AWS</button>}
    />
    <section className="panel" style={{ padding: '22px 26px' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: '15px' }}>How it works</h2>
      <ol className="module-note" style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
        <li>Click <strong>Connect AWS</strong> and launch the one-click CloudFormation stack in your own AWS account.</li>
        <li>Copy the role ARN from the stack’s Outputs tab and paste it here.</li>
        <li>Choose any AWS region, or all regions, and scan. You only ever see your own account’s data.</li>
      </ol>
      <p className="live-note">You can disconnect at any time with Disconnect AWS, or by deleting the stack in your AWS account.</p>
    </section>
  </div>;
}

function ConnectAwsButton({ connected, onConnected, onDisconnect, openRequest = 0 }) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => { if (openRequest > 0) setIsOpen(true); }, [openRequest]);
  const [info, setInfo] = useState(null);
  const [roleArn, setRoleArn] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isOpen || info) return;
    requestJson('/api/connect/start', { method: 'POST' })
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [isOpen, info]);

  const launchUrl = info
    ? 'https://console.aws.amazon.com/cloudformation/home#/stacks/quickcreate'
      + `?stackName=FinOpsBharatReadOnly&templateURL=${encodeURIComponent(info.template_url)}`
      + `&param_TrustedAccountId=${info.trusted_account_id}&param_ExternalId=${info.external_id}`
    : '';

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await requestJson('/api/connect/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_arn: toRoleArn(roleArn, info?.role_name) }),
      });
      setIsOpen(false);
      setRoleArn('');
      onConnected(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return <>
    {connected
      ? <button className="connect-button" onClick={onDisconnect}><Cloud size={16} /> Disconnect AWS</button>
      : <button className="connect-button" onClick={() => setIsOpen(true)}><Cloud size={16} /> Connect AWS</button>}

    {isOpen && <div className="modal-backdrop" role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}>
      <section className="webhook-modal panel" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="panel-heading">
          <div>
            <h2 id="connect-title">Connect your AWS account</h2>
            <p>Read-only access via an IAM role you create. No access keys are shared.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={() => setIsOpen(false)}><X size={17} /></button>
        </div>

        {info
          ? <ol className="module-note" style={{ display: 'grid', gap: '6px', paddingLeft: '20px', margin: '0 0 14px' }}>
              <li>
                <a href={launchUrl} target="_blank" rel="noreferrer">Launch CloudFormation stack <ExternalLink size={13} /></a>
                {' '}in your AWS account. Leave the <strong>Permissions</strong> box empty, tick the IAM acknowledgement box at the bottom, and click <strong>Create stack</strong>.
              </li>
              <li>Wait until the stack status shows <strong>CREATE_COMPLETE</strong>.</li>
              <li>Type your <strong>12-digit AWS account ID</strong> below (shown at the top right of the AWS console). Or open the stack&apos;s <strong>Outputs</strong> tab and paste the <strong>RoleArn</strong> value. It ends with <code>:role/{info.role_name || 'FinOpsBharatReadOnly'}</code>.</li>
              <li>Click <strong>Verify &amp; connect</strong>.</li>
            </ol>
          : <p className="module-note">Preparing your secure setup…</p>}
        {info && <details className="module-note" style={{ margin: '0 0 14px' }}>
          <summary>Already created the role before, or connecting from a new browser?</summary>
          <p>Each browser gets its own External ID. If your existing role was created with a different one, open <strong>CloudFormation → Stacks → FinOpsBharatReadOnly → Update stack → Make a direct update → Use existing template</strong>, set <strong>ExternalId</strong> to <code>{info.external_id}</code>, and finish the update. Then click <strong>Verify &amp; connect</strong>.</p>
        </details>}

        <form onSubmit={submit}>
          <label>Your AWS account ID or role ARN
            <input value={roleArn} onChange={(e) => setRoleArn(e.target.value)} required
              autoComplete="off" pattern="(\d{12}|arn:aws:iam::\d{12}:role/.+)"
              placeholder="12-digit account ID, or arn:aws:iam::<account-id>:role/FinOpsBharatReadOnly" />
          </label>
          {error && <div className="live-error" role="alert"><span>{error}</span></div>}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={() => setIsOpen(false)}>Cancel</button>
            <button className="primary-button" type="submit" disabled={!info || !roleArn || busy}>
              {busy ? 'Verifying…' : 'Verify & connect'}
            </button>
          </div>
        </form>
      </section>
    </div>}
  </>;
}

function ResourceMixChart({ resources, region }) {
  const counts = new Map();
  resources.forEach((resource) => {
    const key = resource.service || resource.category || resource.type || 'Other';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!rows.length) return null;
  const max = rows[0][1];
  const idle = resources.filter((resource) => resource.is_waste_candidate).length;
  return <div style={{ marginTop: '22px', paddingTop: '18px', borderTop: '1px solid #e2e6df' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
      <strong style={{ fontSize: '13px', color: '#2c362f' }}>Resources by service</strong>
      <small style={{ color: '#858d85', fontSize: '11px' }}>{resources.length} observed in {region} · {idle} idle candidate{idle === 1 ? '' : 's'}</small>
    </div>
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px' }} aria-label="Observed resources by AWS service">
      {rows.map(([name, count]) => <li key={name} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 32px', alignItems: 'center', gap: '12px', fontSize: '12px', color: '#424c44' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ height: '10px', background: '#eef1ec', borderRadius: '5px', overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${Math.max(6, (count / max) * 100)}%`, background: '#3c8062', borderRadius: '5px' }} />
        </span>
        <strong style={{ textAlign: 'right', color: '#2c362f' }}>{count}</strong>
      </li>)}
    </ul>
    <p className="live-note">Live inventory counts from the read-only scan. Spend values appear here once Cost Explorer returns billing data.</p>
  </div>;
}

// ---- AWS Resource Metrics panel (live Cost Explorer + CloudWatch data for the connected account) ----
const MT = {
  tile: 'rgba(0,0,0,0.02)', line: 'rgba(0,0,0,0.10)', text: 'currentColor', muted: '#6b756d',
  green: '#2e9e62', blue: '#2a8dc0', track: 'rgba(0,0,0,0.09)',
};

function moneyShort(amount, currency) {
  const n = Math.abs(Number(amount)) < 0.005 ? 0 : Number(amount);   // avoids "-US$0"
  return formatMoney(n, currency).replace(/\.00$/, '');
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)} TB`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)} KB`;
  return `${Math.round(value)} B`;
}

function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function EcTwoLineChart({ days, currency }) {
  const [hover, setHover] = useState(null);
  const W = 560; const H = 175; const L = 50; const R = 38; const T = 10; const B = 26;
  const iw = W - L - R; const ih = H - T - B;
  const maxCost = Math.max(...days.map((d) => d.cost), 0.01) * 1.15;
  const maxHours = Math.max(...days.map((d) => d.hours), 1) * 1.15;
  const x = (i) => L + (days.length === 1 ? iw / 2 : (i * iw) / (days.length - 1));
  const costPts = days.map((d, i) => [x(i), T + ih - (d.cost / maxCost) * ih]);
  const hourPts = days.map((d, i) => [x(i), T + ih - (d.hours / maxHours) * ih]);
  const area = (pts) => `${smoothPath(pts)} L${pts.at(-1)[0]},${T + ih} L${pts[0][0]},${T + ih} Z`;
  const fine = maxCost < 1;   // tiny amounts need more decimals or every axis label reads the same
  const money = (v) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: fine ? 3 : 0, maximumFractionDigits: fine ? 3 : 2 }).format(v); } catch { return `${v.toFixed(fine ? 3 : 0)} ${currency}`; }
  };
  const day = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
  const active = hover == null ? null : days[hover];
  return <div style={{ position: 'relative' }}>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Daily EC2 running hours and cost for the last seven days">
      <defs>
        <linearGradient id="mt-g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={MT.green} stopOpacity="0.38" /><stop offset="1" stopColor={MT.green} stopOpacity="0.02" /></linearGradient>
        <linearGradient id="mt-g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={MT.blue} stopOpacity="0.30" /><stop offset="1" stopColor={MT.blue} stopOpacity="0.02" /></linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = T + (ih * i) / 4;
        return <g key={i}>
          <line x1={L} x2={W - R} y1={y} y2={y} stroke={MT.line} strokeWidth="1" />
          <text x={L - 8} y={y + 4} textAnchor="end" fontSize="10" fill={MT.muted}>{money(maxCost * (1 - i / 4))}</text>
          <text x={W - R + 8} y={y + 4} fontSize="10" fill={MT.muted}>{Math.round(maxHours * (1 - i / 4))}h</text>
        </g>;
      })}
      <path d={area(hourPts)} fill="url(#mt-g2)" />
      <path d={area(costPts)} fill="url(#mt-g1)" />
      <path d={smoothPath(hourPts)} fill="none" stroke={MT.blue} strokeWidth="2" strokeLinecap="round" />
      <path d={smoothPath(costPts)} fill="none" stroke={MT.green} strokeWidth="2" strokeLinecap="round" />
      {days.map((d, i) => <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
        <rect x={x(i) - 20} y={T} width="40" height={ih} fill="transparent" />
        <text x={x(i)} y={H - 7} textAnchor="middle" fontSize="10.5" fill={hover === i ? MT.text : MT.muted}>{day(d.date)}</text>
        <circle cx={hourPts[i][0]} cy={hourPts[i][1]} r={hover === i ? 5 : 3.5} fill="#ffffff" stroke={MT.blue} strokeWidth="2" />
        <circle cx={costPts[i][0]} cy={costPts[i][1]} r={hover === i ? 5 : 3.5} fill="#ffffff" stroke={MT.green} strokeWidth="2" />
        <title>{`${d.date}: ${money(d.cost)} · ${Math.round(d.hours)} running hours`}</title>
      </g>)}
    </svg>
    {active && <div style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', background: '#ffffff', border: `1px solid ${MT.line}`, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', borderRadius: 8, padding: '5px 10px', fontSize: 12, pointerEvents: 'none' }}>
      {active.date} · <span style={{ color: MT.green }}>{money(active.cost)}</span> · <span style={{ color: MT.blue }}>{Math.round(active.hours)} h</span>
    </div>}
  </div>;
}

function MetricGauge({ fraction, color, center, caption }) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const arc = 'M 14 86 A 66 66 0 0 1 146 86';
  return <div style={{ textAlign: 'center' }}>
    <svg viewBox="0 0 160 100" style={{ width: '100%', maxWidth: 130, display: 'block', margin: '0 auto' }} role="img" aria-label={caption}>
      <path d={arc} fill="none" stroke={MT.track} strokeWidth="13" strokeLinecap="round" pathLength="100" />
      {f > 0 && <path d={arc} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" pathLength="100" strokeDasharray={`${f * 100} 100`} />}
      <text x="80" y="78" textAnchor="middle" fontSize="20" fontWeight="700" fill={MT.text}>{center}</text>
    </svg>
    <div style={{ fontSize: 11, color: MT.muted, marginTop: 0 }}>{caption}</div>
  </div>;
}

function ResourceMetrics({ region, accountId, regions, onRegionChange }) {
  const [state, setState] = useState({ data: null, error: '', loading: false });
  useEffect(() => {
    if (!region || !accountId) return undefined;
    let cancelled = false;
    setState({ data: null, error: '', loading: true });
    requestJson(`/api/aws/metrics?region=${encodeURIComponent(region)}`)
      .then((data) => { if (!cancelled) setState({ data, error: '', loading: false }); })
      .catch((error) => { if (!cancelled) setState({ data: null, error: error.message, loading: false }); });
    return () => { cancelled = true; };
  }, [region, accountId]);
  if (!region || !accountId) return null;

  const { data, error, loading } = state;
  const days = data?.ec2_daily || [];
  const hasEc2 = days.some((d) => d.cost > 0 || d.hours > 0);
  const cost = data?.cost;
  const projected = cost?.projected ?? null;
  const gaugeBase = cost?.last_month > 0 ? cost.last_month : null;
  const costFraction = projected != null && gaugeBase ? projected / gaugeBase : 0;
  const s3 = data?.s3;
  const standardShare = s3?.total_bytes > 0 ? s3.standard_bytes / s3.total_bytes : 0;
  const net = data?.network;
  const netMax = Math.max(net?.in_bytes || 0, net?.out_bytes || 0, 1);
  const tile = { background: MT.tile, border: `1px solid ${MT.line}`, borderRadius: 12, padding: '10px 14px' };
  const title = { margin: 0, fontSize: 13, fontWeight: 600, color: MT.text };
  const note = { margin: '6px 0 0', fontSize: 11, color: MT.muted };

  return <section className="panel" aria-label="AWS resource metrics" style={{ padding: 14, margin: '18px 0' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      <div><h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>AWS Resource Metrics</h2>
        <small style={{ color: MT.muted }}>{region} · last 7 days · Cost Explorer &amp; CloudWatch</small></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {regions?.length > 0 && onRegionChange && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: MT.muted }}>Region
          <select value={region} onChange={(event) => onRegionChange(event.target.value)} aria-label="AWS region for these metrics" style={{ font: 'inherit', fontSize: 12, padding: '3px 6px', borderRadius: 8, border: `1px solid ${MT.line}`, background: 'transparent', color: 'inherit' }}>
            {getRegionGroups(regions).map((group) => <optgroup label={group.label} key={group.label}>{group.regions.map((item) => <option key={item.id} value={item.id}>{regionDisplayName(item)}</option>)}</optgroup>)}
          </select>
        </label>}
        <span style={{ fontSize: 11, color: MT.green, border: `1px solid ${MT.line}`, borderRadius: 999, padding: '3px 10px' }}>{loading ? 'LOADING…' : data?.cached ? 'LIVE · CACHED' : 'LIVE'}</span>
      </div>
    </div>
    {error && <p style={{ ...note, color: '#c0392b' }}>{error}</p>}
    {loading && !data && <p style={note}>Loading metrics from your AWS account…</p>}
    {data && <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ ...tile, flex: '2 1 420px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <h3 style={title}>Daily EC2 usage vs. cost</h3>
            <span style={{ fontSize: 12, color: MT.muted }}><span style={{ color: MT.green }}>●</span> Cost ({data.currency}) &nbsp; <span style={{ color: MT.blue }}>●</span> Running hours</span>
          </div>
          {hasEc2 ? <EcTwoLineChart days={days} currency={data.currency} /> : <p style={{ ...note, padding: '24px 0', textAlign: 'center' }}>No EC2 cost or running hours were recorded in the last 7 days.</p>}
        </div>
        <div style={{ flex: '1 1 240px', display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={tile}>
            <h3 style={{ ...title, marginBottom: 4 }}>S3 storage · {region}</h3>
            {s3 && s3.total_bytes > 0
              ? <MetricGauge fraction={standardShare} color={MT.green} center={formatBytes(s3.total_bytes)} caption={`${Math.round(standardShare * 100)}% in Standard class · ${s3.bucket_count} bucket${s3.bucket_count === 1 ? '' : 's'}`} />
              : <p style={note}>No S3 storage metrics in this region yet. CloudWatch reports bucket size once a day, so new buckets can take about a day to appear.</p>}
          </div>
          <div style={tile}>
            <h3 style={{ ...title, marginBottom: 4 }}>Projected monthly cost</h3>
            {cost && (projected != null || cost.month_to_date != null)
              ? <MetricGauge fraction={costFraction} color={MT.blue} center={moneyShort(projected ?? cost.month_to_date, data.currency)}
                caption={projected != null ? (gaugeBase ? `Run-rate estimate · last month ${moneyShort(gaugeBase, data.currency)}` : 'Run-rate estimate · no last-month bill yet') : `Month to date (projection starts on day 3)`} />
              : <p style={note}>Cost Explorer has not returned billing data for this account yet.</p>}
          </div>
        </div>
      </div>
      <div style={{ ...tile, marginTop: 10 }}>
        <h3 style={{ ...title, marginBottom: 6 }}>EC2 network traffic (7 days)</h3>
        {net && net.instance_count > 0
          ? [['Ingress', net.in_bytes, MT.green], ['Egress', net.out_bytes, MT.blue]].map(([label, bytes, color]) => <div key={label} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 80px', alignItems: 'center', gap: 10, margin: '6px 0' }}>
            <span style={{ color: MT.muted, fontSize: 12 }}>{label}</span>
            <span style={{ height: 6, borderRadius: 999, background: MT.track, overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.max(2, (bytes / netMax) * 100)}%`, background: color, borderRadius: 999 }} /></span>
            <strong style={{ fontSize: 12, textAlign: 'right' }}>{formatBytes(bytes)}</strong>
          </div>)
          : <p style={note}>No EC2 network metrics in {region} for the last 7 days.</p>}
        <p style={note}>Instance-level CloudWatch NetworkIn/NetworkOut, summed over {net?.instance_count || 0} instance(s). It includes traffic inside AWS, so it is not the same as your internet data-transfer bill.</p>
      </div>
      {data.warnings?.length > 0 && <p style={{ ...note, color: '#a8741a' }}>{data.warnings.join(' · ')}</p>}
      <p style={note}>Cost Explorer requests cost about $0.01 each on your AWS bill; this panel is cached for 15 minutes.</p>
    </>}
  </section>;
}

function Overview({
  account, accountError, costs, costError, costLoading, latestCost,
  latestCostLabel, scan, scanError, scanLoading, region, regionData, onRegionChange,
  regionError, onScan, onOpenInventory, onRetryAccount, onRetryCosts,
}) {
  const monthly = costs?.monthly || [];
  const resources = scan?.resources || [];
  const serviceTotals = costs?.services || [];
  return <div className="page-wrap overview-page">
    <PageHeading
      eyebrow="AWS ACCOUNT / LIVE DATA"
      title={account ? 'Cloud operations, from your AWS account.' : 'Connect this app to its AWS runtime role.'}
      description="Account identity, resource inventory, and cost data are fetched directly from AWS. This dashboard does not estimate per-resource savings."
      action={<button className="primary-button" disabled={!region || scanLoading} onClick={onScan}><Activity size={16} />{scanLoading ? 'Scanning…' : 'Run read-only scan'}</button>}
    />
    <ErrorPanel message={accountError} onRetry={onRetryAccount} />
    <ErrorPanel message={regionError} />
    <ErrorPanel message={scanError} onRetry={onScan} />
    <ErrorPanel message={costError} onRetry={onRetryCosts} />

    <div className="scan-strip"><span className={`scan-pulse ${scan ? '' : 'scan-pulse-off'}`} />{scan ? `Last inventory scan ${new Date(scan.scanned_at).toLocaleDateString()}` : 'Inventory has not been scanned'}{scan && <><span className="scan-divider" /><strong>{scan.region}</strong></>}<span className="scan-divider" /><span className="scan-mode">{scanLoading ? 'Scan in progress' : 'Read-only AWS APIs'}</span></div>

    <section className="metric-grid" aria-label="Live AWS metrics">
      <MetricCard label="AWS ACCOUNT" value={account?.account_id || 'Unavailable'} detail={account?.arn || accountError || 'Checking AWS server identity'} icon={Cloud} tone="green" />
      <MetricCard label="LAST-MONTH AWS SPEND" value={latestCost ? formatMoney(latestCost.amount, latestCost.currency) : costLoading ? 'Loading…' : 'Unavailable'} detail={latestCostLabel} icon={Activity} tone="gold" />
      <MetricCard label="LIVE INVENTORY RESOURCES" value={scan ? String(scan.resource_count) : scanLoading ? 'Loading…' : 'Unavailable'} detail={scan ? `Observed in ${scan.region}` : scanError || 'Run a scan to load inventory'} icon={Server} tone="blue" />
    </section>

    <ResourceMetrics
      region={region && region !== 'all' ? region : account?.region}
      accountId={account?.account_id}
      regions={regionData}
      onRegionChange={onRegionChange}
    />

    <section className="overview-grid">
      <article className="panel spend-panel">
        <div className="panel-heading"><div><h2>AWS spend by month</h2><p>Cost Explorer · six complete calendar months</p></div><span className="billing-data-tag">UNBLENDED COST</span></div>
        {monthly.length
          ? <><div className="chart-summary"><strong>{formatMoney(latestCost?.amount, latestCost?.currency)}</strong><small>{latestCostLabel}</small></div><Suspense fallback={<div className="chart-loading">Loading chart…</div>}><SpendChart data={monthly.map((item) => ({ month: item.month.slice(0, 7), spend: Number(item.amount) }))} currency={costs.currency} /></Suspense><div className="chart-footnote"><span>Source: AWS Cost Explorer</span><span>Amounts reported by AWS in {costs.currency}</span></div></>
          : <>
            <EmptyPanel loading={costLoading} message={costError || 'Cost Explorer has not returned billing data.'} />
            {!costLoading && <p className="module-note">Enable Cost Explorer in AWS Billing (it can take up to 24 hours to fill in) and make sure the connected role allows ce:Get* actions.</p>}
            {resources.length > 0 && <ResourceMixChart resources={resources} region={scan?.region || region} />}
          </>}
      </article>
      <article className="panel findings-panel">
        <div className="panel-heading"><div><h2>Observed AWS resources</h2><p>Multi-service read-only scan</p></div><button className="text-button" onClick={onOpenInventory}>View inventory <span aria-hidden="true">→</span></button></div>
        {scan
          ? resources.length
            ? <div className="finding-list">{resources.slice(0, 5).map((resource) => <Finding key={`${resource.region}-${resource.id}`} resource={resource} />)}</div>
            : <EmptyPanel message="No unattached EBS volumes or unassociated Elastic IPs were returned by this scan." />
          : <EmptyPanel loading={scanLoading} message={scanError || 'Run a scan to load actual AWS inventory.'} />}
        {scan && resources.length > 0 && <p className="live-note">Resource prices are not available from inventory APIs; no savings amount is shown.</p>}
      </article>
    </section>

    <SpendChanges costs={costs} />

    <section className="panel allocation-panel live-services">
      <div className="panel-heading"><div><h2>Spend by AWS service</h2><p>Cost Explorer · same six-month period</p></div></div>
      {serviceTotals.length
        ? <div className="service-list">{serviceTotals.slice(0, 10).map((service) => <div className="service-row" key={service.name}><div className="service-label"><span>{service.name}</span><strong>{formatMoney(service.amount, service.currency)}</strong></div></div>)}</div>
        : <EmptyPanel loading={costLoading} message={costError || 'No service billing data is available.'} />}
    </section>
    <div className="disclaimer-line"><ShieldCheck size={15} /><span>Inventory and costs are live AWS responses. Cost Explorer amounts may be delayed and are not a per-resource savings calculation. No remediation actions are performed.</span></div>
    <AccountDetails account={account} />
  </div>;
}

function SpendChanges({ costs }) {
  const months = costs?.monthly || [];
  const byMonth = costs?.service_by_month;
  if (months.length < 2 || !byMonth) return null;
  const latest = months[months.length - 1];
  const before = months[months.length - 2];
  const now = byMonth[latest.month] || {};
  const prev = byMonth[before.month] || {};
  const rows = [...new Set([...Object.keys(now), ...Object.keys(prev)])]
    .map((name) => ({ name, now: Number(now[name] || 0), before: Number(prev[name] || 0) }))
    .map((row) => ({ ...row, diff: row.now - row.before }))
    .filter((row) => Math.abs(row.diff) >= 0.005)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5);
  const totalDiff = Number(latest.amount) - Number(before.amount);
  const pct = Number(before.amount) > 0 ? (totalDiff / Number(before.amount)) * 100 : null;
  const direction = (value) => (value > 0 ? 'up' : 'down');
  return <section className="panel allocation-panel live-services">
    <div className="panel-heading"><div><h2>What changed in your bill</h2><p>{before.month.slice(0, 7)} → {latest.month.slice(0, 7)} · biggest movers by service · Cost Explorer</p></div></div>
    <div className="module-stat"><strong>{totalDiff >= 0 ? '+' : '−'}{formatMoney(Math.abs(totalDiff), costs.currency)}</strong><span>{pct == null ? 'total change' : `total ${direction(totalDiff)} ${Math.abs(pct).toFixed(0)}% vs the month before`}</span></div>
    {rows.length
      ? <div className="service-list">{rows.map((row) => <div className="service-row" key={row.name}><div className="service-label"><span>{row.name}</span><strong>{row.diff >= 0 ? '+' : '−'}{formatMoney(Math.abs(row.diff), costs.currency)} ({direction(row.diff)})</strong></div></div>)}</div>
      : <p className="module-empty">No service changed between these two months.</p>}
    <p className="module-note">Review the services that went up first. A rise is not always waste, so confirm with the owner before changing anything.</p>
  </section>;
}

function LearningGuide({
  account, costs, resources, region, lessons, openLesson, setOpenLesson,
  completedLessons, onToggleComplete, onOpenInventory, onOpenOverview,
}) {
  const monthly = costs?.monthly || [];
  const latest = monthly.at(-1);
  const previous = monthly.at(-2);
  const latestAmount = latest ? Number(latest.amount) : null;
  const previousAmount = previous ? Number(previous.amount) : null;
  const monthChange = latestAmount !== null && previousAmount !== null
    ? latestAmount - previousAmount
    : null;
  const monthChangePercent = monthChange !== null && previousAmount !== 0
    ? (monthChange / previousAmount) * 100
    : null;
  const serviceLeaders = (costs?.services || []).slice(0, 3);
  const completedCount = completedLessons.length;
  const completionScore = Math.round((completedCount / lessons.length) * 100);
  const currency = costs?.currency;

  return <div className="page-wrap learning-guide-page">
    <PageHeading
      eyebrow="FINOPS PRACTICE / LIVE ACCOUNT CONTEXT"
      title="Learn FinOps with your AWS data."
      description="Work through practical cost, allocation, investigation, governance, and budget-monitoring skills using the account’s current Cost Explorer and inventory results."
      action={<span className="learning-account-tag">{account ? `ACCOUNT ${account.account_id}` : 'AWS ACCOUNT NOT LOADED'}</span>}
    />
    <section className="learning-progress panel" aria-label="Learning progress">
      <div><span className="eyebrow">YOUR LEARNING PROGRESS</span><strong>{completedCount} of {lessons.length} topics completed</strong><small>Progress is saved in this browser for this AWS account.</small></div>
      <div className="learning-progress-score" aria-live="polite"><strong>{completionScore}<span>/100</span></strong><small>complete</small></div>
      <progress value={completionScore} max="100" aria-label={`${completionScore} percent complete`} />
    </section>
    <div className="learning-live-context">
      <article className="panel learning-context-card">
        <span className="eyebrow">YOUR LATEST BILLING DATA</span>
        {latest
          ? <><strong>{formatMoney(latest.amount, latest.currency)}</strong><small>{new Date(`${latest.month}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })} · Cost Explorer</small>
            {monthChange !== null && <p className={monthChange > 0 ? 'learning-change learning-change-up' : 'learning-change'}>{formatMoney(Math.abs(monthChange), currency)} {monthChange > 0 ? 'higher' : 'lower'} than the prior month{monthChangePercent !== null ? ` (${Math.abs(monthChangePercent).toFixed(1)}%)` : ''}</p>}
          </>
          : <><strong>{costs ? 'No cost rows returned' : 'Billing data unavailable'}</strong><small>{costs?.currency ? `Currency: ${costs.currency}` : 'Cost Explorer access is required for live bill exercises.'}</small></>}
      </article>
      <article className="panel learning-context-card">
        <span className="eyebrow">YOUR INVENTORY SCAN</span>
        <strong>{resources.length} observed finding{resources.length === 1 ? '' : 's'}</strong>
        <small>{region ? `${region} · unattached volumes and unassociated IPs` : 'Select and scan an enabled AWS region to load evidence.'}</small>
        <button className="text-button learning-context-action" onClick={onOpenInventory}>Open current inventory <span aria-hidden="true">→</span></button>
      </article>
      <article className="panel learning-context-card">
        <span className="eyebrow">TOP SERVICE COSTS</span>
        {serviceLeaders.length
          ? <ul className="learning-service-list">{serviceLeaders.map((service) => <li key={service.name}><span>{service.name}</span><strong>{formatMoney(service.amount, service.currency)}</strong></li>)}</ul>
          : <><strong>Not available</strong><small>Service breakdown appears when Cost Explorer returns billing data.</small></>}
      </article>
    </div>

    <section className="learning-curriculum" aria-labelledby="curriculum-title">
      <div className="section-title"><div><span className="eyebrow">PRACTICAL CURRICULUM</span><h2 id="curriculum-title">Build the habits behind better cloud decisions.</h2></div></div>
      <div className="learning-lesson-list">
        {lessons.map((lesson, index) => {
          const isComplete = completedLessons.includes(lesson.id);
          const isOpen = openLesson === lesson.id;
          return <article className={`learning-lesson panel ${isOpen ? 'learning-lesson-open' : ''}`} key={lesson.id}>
            <button className="learning-lesson-toggle" aria-expanded={isOpen} onClick={() => setOpenLesson(isOpen ? '' : lesson.id)}>
              <span className="learning-lesson-number">{String(index + 1).padStart(2, '0')}</span>
              <span className={`learning-lesson-check ${isComplete ? 'learning-lesson-check-complete' : ''}`}>{isComplete && <Check size={14} />}</span>
              <span className="learning-lesson-title"><strong>{lesson.title}</strong><small>{lesson.skill} · {isComplete ? 'Completed' : 'In progress'}</small></span>
              <ChevronDown className={isOpen ? 'learning-chevron learning-chevron-open' : 'learning-chevron'} size={17} />
            </button>
            {isOpen && <div className="learning-lesson-body">
              <p>{lesson.description}</p>
              <LearningExercise lessonId={lesson.id} latest={latest} previous={previous} monthChange={monthChange} currency={currency} serviceLeaders={serviceLeaders} resources={resources} region={region} account={account} onOpenInventory={onOpenInventory} onOpenOverview={onOpenOverview} />
              <div className="learning-lesson-footer">
                <div className="learning-resources">
                  <a href={lesson.document} target="_blank" rel="noreferrer">{lesson.documentLabel} <ExternalLink size={13} /></a>
                  {lesson.video && <a href={lesson.video} target="_blank" rel="noreferrer">{lesson.videoLabel} <ExternalLink size={13} /></a>}
                </div>
                <button className={isComplete ? 'secondary-button' : 'primary-button'} onClick={() => onToggleComplete(lesson.id)}>{isComplete ? 'Mark as in progress' : 'Mark topic complete'}</button>
              </div>
            </div>}
          </article>;
        })}
      </div>
      {completedCount === lessons.length && <section className="learning-reward" role="status" aria-label="Learning guide complete">
        <span className="learning-reward-icon"><Trophy size={24} /></span>
        <div><span className="eyebrow">LEARNING GUIDE COMPLETE</span><h3>Cloud cost champion!</h3><p>You built all five habits for making better cloud decisions.</p></div>
        <strong className="learning-reward-score">100<span>/100</span></strong>
      </section>}
    </section>
    <p className="learning-guide-note">Learning steps are educational guidance, not automated recommendations. Account figures come from AWS APIs and may be delayed; confirm billing, ownership, service impact, retention, and approvals before acting.</p>
  </div>;
}

function LearningExercise({
  lessonId, latest, previous, monthChange, currency, serviceLeaders,
  resources, region, account, onOpenInventory, onOpenOverview,
}) {
  if (lessonId === 'read-the-bill') {
    return <div className="learning-exercise"><strong>Use your actual bill</strong>{latest && previous
      ? <p>Compare {formatMoney(previous.amount, previous.currency)} in {previous.month.slice(0, 7)} with {formatMoney(latest.amount, latest.currency)} in {latest.month.slice(0, 7)}. The difference is {formatMoney(Math.abs(monthChange), currency)} {monthChange > 0 ? 'more' : monthChange < 0 ? 'less' : 'unchanged'}; inspect the service breakdown before attributing the movement.</p>
      : <p>Two complete months of Cost Explorer data are needed to make a month-to-month comparison. No placeholder values are used.</p>}
      <button className="text-button" onClick={onOpenOverview}>Review spend history <span aria-hidden="true">→</span></button>
    </div>;
  }
  if (lessonId === 'investigate-idle') {
    return <div className="learning-exercise"><strong>Investigate this account’s current findings</strong>
      {resources.length
        ? <><p>The {region} scan returned {resources.length} resource{resources.length === 1 ? '' : 's'} for review. Confirm the owner, workload dependency, backup and retention requirements, and change approval before making any manual change.</p><ul>{resources.slice(0, 4).map((resource) => <li key={resource.id}><span>{resource.service} · {resource.type}</span><strong>{resource.name} · {resource.state || 'unknown'}</strong></li>)}</ul></>
        : <p>The latest scan has no findings to investigate, or inventory has not loaded yet. Run a read-only region scan before using this exercise.</p>}
      <button className="text-button" onClick={onOpenInventory}>Inspect live findings <span aria-hidden="true">→</span></button>
    </div>;
  }
  if (lessonId === 'allocate-costs') {
    return <div className="learning-exercise"><strong>Practice service-level cost allocation</strong>
      {serviceLeaders.length
        ? <><p>Cost Explorer currently groups charges by AWS service. Ask your team which application and owner account for each category; service totals alone do not identify a responsible workload.</p><ul>{serviceLeaders.map((service) => <li key={service.name}><span>{service.name}</span><strong>{formatMoney(service.amount, service.currency)}</strong></li>)}</ul></>
        : <p>Service-level cost data is unavailable. Check Cost Explorer permissions and billing data before completing this exercise.</p>}
      <p>For workload allocation, define an organization-owned tag vocabulary, activate the relevant cost allocation tags in Billing, and validate that teams consistently apply them.</p>
    </div>;
  }
  if (lessonId === 'billing-alerts') {
    return <div className="learning-exercise"><strong>Build an alert around your AWS spending</strong>
      {latest
        ? <p>Your latest complete month, {latest.month.slice(0, 7)}, is {formatMoney(latest.amount, latest.currency)}. Use this actual Cost Explorer amount, recent trends, and your approved business budget to choose a threshold; this app does not invent a budget or create alerts.</p>
        : <p>Cost Explorer data is not available right now. Load actual billing history before choosing a threshold; do not use a guessed amount as a budget.</p>}
      <ol>
        <li>Open AWS Billing and Cost Management and create an AWS Budget for the intended account or workload.</li>
        <li>Choose a budget amount and period approved by your finance or workload owner.</li>
        <li>Add actual-cost notifications at thresholds that give owners time to respond, then configure forecast notifications if useful.</li>
        <li>Send alerts to a monitored team distribution list and verify delivery with the recipients.</li>
        <li>Review actual versus budgeted spend regularly; an alert signals review, not automatic cost control.</li>
      </ol>
      <p>Creating budgets or notifications changes AWS account configuration. Complete that setup in AWS only if your role is authorized; FinOps-Bharat remains read-only.</p>
    </div>;
  }
  return <div className="learning-exercise"><strong>Use a change-control checklist</strong>
    <p>Before a resource change, identify the owner, confirm customer and workload impact, verify backups and retention, secure explicit approval, choose a change window, and document rollback steps.</p>
    <p>{account ? `The connected server role is ${account.arn}.` : 'The server-side AWS identity is not available yet.'} This application performs read-only calls and will not execute a cleanup command.</p>
    <p>{resources.length ? `The current scan in ${region || 'the selected region'} includes ${resources.length} findings; treat each as a prompt for human review, not a deletion recommendation.` : 'No live inventory findings are currently available.'}</p>
  </div>;
}

function EmptyPanel({ loading, message }) {
  return <div className="live-empty">{loading && <LoaderCircle className="spin" size={17} />}<span>{message}</span></div>;
}

function AccountDetails({ account }) {
  if (!account) return null;
  return <details className="account-details"><summary>Server-side AWS identity details</summary><dl><dt>Account</dt><dd>{account.account_id}</dd><dt>Region</dt><dd>{account.region}</dd><dt>Caller ARN</dt><dd>{account.arn}</dd></dl></details>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }) {
  return <article className="metric-card"><div className={`metric-icon metric-${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></article>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Finding({ resource }) {
  return <div className="finding"><span className="finding-icon"><Server size={16} /></span><div className="finding-main"><div className="finding-name">{resource.name}</div><div className="finding-meta">{resource.service ? `${resource.service} · ` : ''}{resource.type}<span>·</span><span className="finding-badge">{resource.state || resource.status || 'unknown'}</span></div></div><span className="finding-region">{resource.region}</span></div>;
}

function Inventory({
  account, resources, allResources, totalResources, query, setQuery, typeFilter,
  setTypeFilter, inventoryQuickFilter, setInventoryQuickFilter, availableTypes,
  region, regionData, scan, scanError, scanLoading, regionError,
  onRegionChange, onScan, onExport,
}) {
  const groupedRegions = getRegionGroups(regionData);
  const filters = [
    { id: 'all', label: 'All Services' },
    { id: 'storage', label: 'Storage (S3/EBS)' },
    { id: 'database', label: 'Databases (RDS/Dynamo)' },
    { id: 'serverless', label: 'Serverless (Lambda/API Gateway)' },
    { id: 'networking', label: 'Networking (VPC/ELB/EIP)' },
  ];
  const scanErrors = scan?.errors || [];
  return <div className="page-wrap inventory-page">
    <PageHeading eyebrow="AWS SERVICES / LIVE INVENTORY" title="Resource inventory" description="Read-only multi-service inventory across AWS regions. Permission failures are reported per service while available results are retained." action={<button className="secondary-button" disabled={!resources.length} onClick={onExport}><Download size={16} /> Export current results</button>} />
    {regionError && <ErrorPanel message={regionError} />}
    {scanError && <ErrorPanel message={scanError} onRetry={onScan} />}
    <div className="inventory-summary"><div><span className="summary-number">{scan ? totalResources : '—'}</span><span>{scan ? `resources observed in ${scan.region}` : 'No successful scan loaded'}</span></div><span className="inventory-readonly"><ShieldCheck size={15} /> Read-only · no changes made</span></div>
    <Suspense fallback={<div className="chart-loading">Loading inventory charts…</div>}>
      <InventoryCharts resources={allResources} />
    </Suspense>
    {scanErrors.length > 0 && <details className="scan-warning">
      <summary>{scanErrors.length} AWS service warning{scanErrors.length === 1 ? '' : 's'} · partial scan results are shown</summary>
      <ul>{scanErrors.map((item, index) => <li key={`${item.region}-${item.service}-${item.operation}-${index}`}><strong>{item.service}</strong> · {item.operation} · {item.region}: {item.message}</li>)}</ul>
    </details>}
    <div className="inventory-toolbar">
      <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, type, or state" aria-label="Search resources" /></label>
      <label className="filter-select"><span className="sr-only">Filter by resource type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option>{availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label className="filter-select region-filter"><span className="sr-only">Select AWS region</span><select value={region} onChange={(event) => onRegionChange(event.target.value)} aria-label="AWS region">
        <option value="all">🌐 All Regions (Global Scan)</option>
        {groupedRegions.map((group) => <optgroup label={group.label} key={group.label}>{group.regions.map((item) => <option key={item.id} value={item.id}>{regionDisplayName(item)}</option>)}</optgroup>)}
      </select><ChevronDown size={13} /></label>
      <button className="filter-button" disabled={!region || scanLoading} onClick={onScan}>{scanLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} {region === 'all' ? 'Scan all regions' : 'Scan region'}</button>
    </div>
    <div className="quick-filter-pills" role="group" aria-label="Filter inventory services">
      {filters.map((filter) => <button type="button" key={filter.id} className={inventoryQuickFilter === filter.id ? 'quick-filter-active' : ''} aria-pressed={inventoryQuickFilter === filter.id} onClick={() => setInventoryQuickFilter(filter.id)}>{filter.label}</button>)}
    </div>
    <div className="table-wrap"><table><thead><tr><th>RESOURCE</th><th>SERVICE / TYPE</th><th>REGION</th><th>OBSERVED STATE</th><th>DETAILS</th><th>MONTHLY COST</th></tr></thead><tbody>
      {resources.map((resource) => <tr key={`${resource.region}-${resource.service}-${resource.id}`}><td><strong className="resource-name">{resource.name}</strong><span className="resource-id">{resource.id}</span></td><td>{resource.service} · {resource.type}</td><td><span className="region-code">{resource.region}</span></td><td><span className={`status-tag ${resource.is_waste_candidate ? 'status-waste' : ''}`}>{resource.state || resource.status || 'unknown'}</span></td><td>{resource.details}</td><td>{resource.estimated_monthly_cost == null ? 'Not provided by AWS' : formatMoney(resource.estimated_monthly_cost, scan?.currency)}</td></tr>)}
      {resources.length === 0 && <tr><td colSpan="6" className="empty-state">{scanLoading ? 'Scanning the selected AWS region…' : scan ? 'No resources match these filters.' : scanError || 'Run a scan to load AWS resources.'}</td></tr>}
    </tbody></table></div>
    <div className="table-bottom"><span>{scan ? `Showing ${resources.length} of ${totalResources} scanned resources` : 'Inventory not yet available'}</span><span>{scan ? `Observed ${new Date(scan.scanned_at).toLocaleString()}` : account ? `AWS account ${account.account_id}` : 'AWS account unavailable'}</span></div>
    <div className="inventory-callout"><span><ShieldCheck size={18} /></span><div><strong>Inventory is informational and read-only.</strong><p>Unattached state does not prove a resource is safe to delete. Validate ownership, backups, retention, and workload dependencies before any manual action.</p></div></div>
  </div>;
}

export default App;
