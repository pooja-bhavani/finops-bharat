import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, BookOpen, Check, ChevronDown, ChevronUp, Cloud, Download,
  ExternalLink, LayoutDashboard, LoaderCircle, RefreshCw, Search, Server, X,
  ShieldCheck, Terminal, Trophy, Container, Tags, Workflow, Bell,
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

function resolveTwsLabsUrl() {
  const configuredUrl = import.meta.env.VITE_TWS_LABS_URL?.trim();
  const hostname = window.location.hostname;
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  let candidate = configuredUrl || '';

  if (!candidate && import.meta.env.DEV) {
    if (isLocalhost) {
      candidate = `http://${hostname}:8080`;
    } else if (window.location.protocol === 'https:') {
      const codespacesHost = hostname.replace(/-\d+\.app\.github\.dev$/, '-8080.app.github.dev');
      if (codespacesHost !== hostname) {
        candidate = `https://${codespacesHost}`;
      }
    }
  }

  if (!candidate) return { url: '', invalid: false };
  try {
    const url = new URL(candidate, window.location.origin);
    const localHttp = import.meta.env.DEV
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.protocol === 'http:'
      && window.location.hostname === url.hostname;
    const secureRemote = url.protocol === 'https:';
    if ((localHttp || secureRemote) && url.origin !== window.location.origin) {
      return { url: url.href.replace(/\/+$/, ''), invalid: false };
    }
  } catch {
    return { url: '', invalid: Boolean(configuredUrl) };
  }
  return { url: '', invalid: Boolean(configuredUrl) };
}

const { url: twsLabsUrl, invalid: invalidTwsLabsUrl } = resolveTwsLabsUrl();

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

function App() {
  const [page, setPage] = useState('overview');
  const [terminalOpen, setTerminalOpen] = useState(false);
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
  const [pullNumber, setPullNumber] = useState('');
  const [parkingEnvironment, setParkingEnvironment] = useState('Dev');
  const [parkingEnabled, setParkingEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSettingsOpen, setWebhookSettingsOpen] = useState(false);
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
      cicd: `/api/cicd/audit?region=${encodeURIComponent(moduleRegion)}`,
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

  useEffect(() => {
    let active = true;
    requestJson('/api/aws/account').then((data) => {
      if (active) setAccount(data);
    }).catch((error) => {
      if (active) setAccountError(error.message);
    });
    setCostLoading(true);
    requestJson('/api/aws/costs').then((data) => {
      if (active) setCosts(data);
    }).catch((error) => {
      if (active) setCostError(error.message);
    }).finally(() => {
      if (active) setCostLoading(false);
    });
    requestJson('/api/aws/regions').then((data) => {
      if (!active) return;
      const nextRegions = data.regions || [];
      const configuredRegion = data.configured_region || nextRegions[0]?.id || '';
      setRegionData(nextRegions);
      setRegion(configuredRegion);
      if (configuredRegion) {
        runScan(configuredRegion);
      }
    }).catch((error) => {
      if (active) setRegionError(error.message);
    });
    return () => { active = false; };
  }, [runScan]);

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
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="FinOps-Bharat home">
        <span className="brand-mark"><Cloud size={20} /></span>
        <span className="brand-name">finops<span>bharat</span><small>Live AWS operations</small></span>
      </a>
      <div className="workspace-label">AWS ACCOUNT</div>
      <div className="workspace-select account-identity" aria-live="polite">
        <span className="workspace-avatar"><Cloud size={16} /></span>
        <span className="workspace-copy">
          <strong>{account ? `Account ${account.account_id}` : 'AWS account unavailable'}</strong>
          <small>{account ? account.region : accountError || 'Checking server identity…'}</small>
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
          <button className="connect-button terminal-toggle" aria-expanded={terminalOpen} onClick={() => setTerminalOpen((open) => !open)}>
            <Terminal size={15} /> {terminalOpen ? 'Close terminal' : 'Open terminal'}
          </button>
          <button className="connect-button" disabled={scanLoading || !region} onClick={() => runScan(region)}>
            {scanLoading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            {scanLoading ? 'Scanning AWS' : 'Refresh inventory'}
          </button>
        </div>
      </header>

      {page === 'overview' && <Overview
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
        regionError={regionError}
        onOpenInventory={() => setPage('inventory')}
        onScan={() => runScan(region)}
        onRetryAccount={loadAccount}
        onRetryCosts={loadCosts}
      />}
      {page === 'inventory' && <Inventory
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
      {page === 'devops' && <DevOpsGovernance
        region={region}
        cloudOps={cloudOps}
        errors={moduleErrors}
        loading={moduleLoading}
        action={moduleAction}
        results={moduleResults}
        pullNumber={pullNumber}
        setPullNumber={setPullNumber}
        parkingEnvironment={parkingEnvironment}
        setParkingEnvironment={setParkingEnvironment}
        parkingEnabled={parkingEnabled}
        setParkingEnabled={setParkingEnabled}
        webhookUrl={webhookUrl}
        setWebhookUrl={setWebhookUrl}
        webhookSettingsOpen={webhookSettingsOpen}
        setWebhookSettingsOpen={setWebhookSettingsOpen}
        onRefresh={loadCloudOps}
        onCleanupPlan={() => postModuleAction('cleanup-plan', '/api/cicd/cleanup', {
          region: moduleRegion,
          volume_ids: (cloudOps.cicd?.stale_unattached_ebs || []).map((volume) => volume.volume_id),
        })}
        onCostCheck={() => postModuleAction('cost-check', '/api/cicd/cost-check', { pull_number: Number(pullNumber) })}
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
      {page === 'containers' && <ContainersPage
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
      {page === 'learn' && <LearningGuide
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
      <footer className="footer"><span>FinOps-Bharat</span><span>Live AWS, GitHub & webhook integrations · review-only AWS actions</span></footer>
    </main>
    {terminalOpen && <TwsLabsDrawer
      url={twsLabsUrl}
      invalidUrl={invalidTwsLabsUrl}
      onClose={() => setTerminalOpen(false)}
    />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
  </div>;
}

function DevOpsGovernance({
  region, cloudOps, errors, loading, action, results, pullNumber, setPullNumber,
  parkingEnvironment, setParkingEnvironment, parkingEnabled, setParkingEnabled,
  webhookUrl, setWebhookUrl, webhookSettingsOpen, setWebhookSettingsOpen,
  onRefresh, onCleanupPlan, onCostCheck, onParkingPlan,
  onTagAlert, onWebhookTest, onPlanEcrCleanup,
}) {
  const disks = cloudOps.cicd?.stale_unattached_ebs || [];
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
        <div className="panel-heading"><div><h2><Workflow size={16} /> CI/CD waste & runner disks</h2><p>Unattached EBS older than 24 hours · {region}</p></div></div>
        <ErrorPanel message={errors.cicd || errors['cleanup-plan']} />
        <div className="module-stat"><strong>{cloudOps.cicd ? disks.length : loading ? '…' : 'Unavailable'}</strong><span>stale unattached disks</span></div>
        <ul className="module-list">{disks.slice(0, 8).map((disk) => <li key={disk.volume_id}><code>{disk.volume_id}</code><span>{disk.size_gib} GiB · {disk.age_hours} h</span>{disk.runner_tagged && <span className="governance-badge governance-clickops">Runner tag</span>}</li>)}</ul>
        {cloudOps.cicd && !disks.length && <p className="module-empty">No unattached EBS volumes older than 24 hours were returned by AWS.</p>}
        {cloudOps.cicd && <p className="module-note">{cloudOps.cicd.docker_volume_note}</p>}
        <button className="secondary-button" disabled={!disks.length || Boolean(action)} onClick={onCleanupPlan}>
          {action === 'cleanup-plan' ? 'Checking live candidates…' : 'Review ephemeral disk cleanup plan'}
        </button>
        {results['cleanup-plan'] && <p className="module-result" role="status">{results['cleanup-plan'].candidate_volume_ids.length} currently eligible disk(s). No volumes were deleted.</p>}
        <form className="module-inline-form" onSubmit={(event) => { event.preventDefault(); onCostCheck(); }}>
          <label>GitHub pull request <input type="number" min="1" value={pullNumber} onChange={(event) => setPullNumber(event.target.value)} required /></label>
          <button className="secondary-button" type="submit" disabled={!pullNumber || Boolean(action)}>Post live cost review</button>
        </form>
        <ErrorPanel message={errors['cost-check']} />
        {results['cost-check'] && <p className="module-result" role="status">Cost review posted to PR #{results['cost-check'].pull_request_number}; the PR delta is explicitly unquantified without a reviewed plan and pricing data.</p>}
      </article>

      <ContainersEcrPanel kubernetes={cloudOps.kubernetes} ecr={cloudOps.ecr} errors={errors} loading={loading} region={region} action={action} results={results} onPlanEcrCleanup={onPlanEcrCleanup} />

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

function TwsLabsDrawer({ url, invalidUrl, onClose }) {
  const [height, setHeight] = useState(220);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef(null);
  const resizeTo = useCallback((clientY) => {
    if (!dragStart.current) return;
    const nextHeight = Math.max(45, Math.min(550, dragStart.current.height + dragStart.current.clientY - clientY));
    if (nextHeight < 60) {
      setHeight(45);
      setIsMinimized(true);
    } else {
      setHeight(nextHeight);
      setIsMinimized(false);
    }
  }, []);
  const stopResizing = useCallback(() => {
    dragStart.current = null;
    setIsResizing(false);
  }, []);

  useEffect(() => {
    const onMouseMove = (event) => resizeTo(event.clientY);
    const onTouchMove = (event) => {
      if (event.touches[0]) resizeTo(event.touches[0].clientY);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', stopResizing);
    window.addEventListener('touchcancel', stopResizing);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopResizing);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stopResizing);
      window.removeEventListener('touchcancel', stopResizing);
    };
  }, [resizeTo, stopResizing]);

  const startResizing = (clientY) => {
    dragStart.current = { clientY, height };
    setIsResizing(true);
  };
  const toggleMinimized = () => {
    const minimized = !isMinimized;
    setIsMinimized(minimized);
    setHeight(minimized ? 45 : 220);
  };

  return <section
    className={`tws-drawer ${isMinimized ? 'tws-drawer-minimized' : ''} ${isResizing ? 'tws-drawer-resizing' : ''}`}
    style={{ height: `${height}px` }}
    aria-label="TWS Labs terminal sandbox"
  >
    <div
      className="terminal-drag-handle"
      role="separator"
      aria-label="Resize terminal panel"
      aria-orientation="horizontal"
      onMouseDown={(event) => {
        if (event.button === 0) startResizing(event.clientY);
      }}
      onTouchStart={(event) => {
        if (event.touches[0]) startResizing(event.touches[0].clientY);
      }}
    ><span className="drag-pill" /></div>
    <header className="tws-drawer-header">
      <div><Terminal size={17} /><strong>Linux sandbox</strong><span>Independent TWS Labs service · never enter production credentials</span></div>
      <div className="tws-drawer-actions">
        {url && <a href={url} target="_blank" rel="noreferrer">Open separately <ExternalLink size={13} /></a>}
        <button type="button" onClick={toggleMinimized} aria-label={isMinimized ? 'Expand terminal' : 'Collapse terminal'}>
          {isMinimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        <button type="button" onClick={onClose} aria-label="Close terminal"><X size={15} /> Close</button>
      </div>
    </header>
    {invalidUrl
      ? <div className="live-error" role="alert"><AlertCircle size={17} /><span>VITE_TWS_LABS_URL must use a separate HTTPS origin (HTTP is allowed only for localhost development).</span></div>
      : url
        ? <iframe
          className="tws-terminal-frame"
          src={url}
          title="TWS Labs Linux terminal sandbox"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
          referrerPolicy="no-referrer"
          allow="clipboard-read; clipboard-write"
        />
        : <div className="tws-drawer-setup">
          <p>Set <code>VITE_TWS_LABS_URL</code> to a separately hosted TWS Labs service. Localhost and GitHub Codespaces development URLs are detected automatically and mapped to port 8080.</p>
          <a href="https://github.com/TrainWithShubham/tws-labs" target="_blank" rel="noreferrer">TWS Labs repository and setup instructions <ExternalLink size={13} /></a>
        </div>}
  </section>;
}

function ErrorPanel({ message, onRetry }) {
  if (!message) return null;
  return <div className="live-error" role="alert"><AlertCircle size={17} /><span>{message}</span>{onRetry && <button onClick={onRetry}>Retry</button>}</div>;
}

function Overview({
  account, accountError, costs, costError, costLoading, latestCost,
  latestCostLabel, scan, scanError, scanLoading, region,
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

    <section className="overview-grid">
      <article className="panel spend-panel">
        <div className="panel-heading"><div><h2>AWS spend by month</h2><p>Cost Explorer · six complete calendar months</p></div><span className="billing-data-tag">UNBLENDED COST</span></div>
        {monthly.length
          ? <><div className="chart-summary"><strong>{formatMoney(latestCost?.amount, latestCost?.currency)}</strong><small>{latestCostLabel}</small></div><Suspense fallback={<div className="chart-loading">Loading chart…</div>}><SpendChart data={monthly.map((item) => ({ month: item.month.slice(0, 7), spend: Number(item.amount) }))} currency={costs.currency} /></Suspense><div className="chart-footnote"><span>Source: AWS Cost Explorer</span><span>Amounts reported by AWS in {costs.currency}</span></div></>
          : <EmptyPanel loading={costLoading} message={costError || 'Cost Explorer has not returned billing data.'} />}
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
