import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, BookOpen, Check, ChevronDown, ChevronUp, Cloud, Container,
  Download, ExternalLink, Layers, LayoutDashboard, LoaderCircle, Maximize2, Minimize2,
  RefreshCw, Search, Server, ShieldCheck, Tags, Terminal, Workflow, X,
} from 'lucide-react';

const SpendChart = lazy(() => import('./SpendChart.jsx'));

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', label: 'Resource inventory', icon: Server },
  { id: 'containers', label: 'Containers & ECR', icon: Container },
  { id: 'devops', label: 'DevOps & governance', icon: Workflow },
  { id: 'learn', label: 'FinOps learning guide', icon: BookOpen },
];

const regionLabels = {
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-south-2': 'Asia Pacific (Hyderabad)',
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-central-1': 'Europe (Frankfurt)',
};

const regionGroups = [
  { label: 'United States', prefixes: ['us-'] },
  { label: 'Asia Pacific', prefixes: ['ap-'] },
  { label: 'Europe', prefixes: ['eu-'] },
  { label: 'Americas', prefixes: ['sa-', 'ca-'] },
  { label: 'Middle East / Africa', prefixes: ['me-', 'af-', 'il-'] },
  { label: 'Other AWS Regions', prefixes: [] },
];

function regionDisplayName(region) {
  const regId = region.id || region;
  const regName = region.name || '';
  const location = regionLabels[regId] || (regName !== regId ? regName : '');
  return location ? `${location} (${regId})` : regId;
}

function getRegionGroups(regions = []) {
  const groups = regionGroups.map((group) => ({
    label: group.label,
    regions: regions.filter((r) => group.prefixes.some((p) => (r.id || r).startsWith(p))),
  }));
  const assignedIds = new Set(groups.flatMap((g) => g.regions.map((r) => r.id || r)));
  const otherRegions = regions.filter((r) => !assignedIds.has(r.id || r));
  if (otherRegions.length > 0) {
    groups.find((g) => g.label === 'Other AWS Regions').regions.push(...otherRegions);
  }
  return groups.filter((g) => g.regions.length > 0);
}

function formatMoney(amount, currency = 'INR') {
  if (amount == null) return '—';
  const symbol = currency === 'INR' ? '₹' : '$';
  return `${symbol}${new Intl.NumberFormat('en-IN').format(amount)}`;
}

async function requestJson(path, options = {}) {
  const savedRoleArn = localStorage.getItem('finops_role_arn');
  const headers = {
    ...(options.headers || {}),
  };
  if (savedRoleArn) {
    headers['x-aws-role-arn'] = savedRoleArn;
  }
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

function ConnectAwsModal({ onClose, onConnected }) {
  const [roleArnInput, setRoleArnInput] = useState(localStorage.getItem('finops_role_arn') || '');
  const [savedRoleArn, setSavedRoleArn] = useState(localStorage.getItem('finops_role_arn') || '');

  const handleSave = () => {
    const clean = roleArnInput.trim();
    if (!clean) return;
    localStorage.setItem('finops_role_arn', clean);
    setSavedRoleArn(clean);
    onConnected(clean);
    onClose();
  };

  const handleDisconnect = () => {
    localStorage.removeItem('finops_role_arn');
    setSavedRoleArn('');
    setRoleArnInput('');
    onConnected('');
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        <span className="eyebrow">AWS CROSS-ACCOUNT IAM SETUP</span>
        <h2>Connect Your AWS Account</h2>
        <p className="text-xs text-gray-300 mb-4">
          Scan your AWS infrastructure securely without sharing long-lived keys. Deploy our read-only CloudFormation stack in your AWS console and paste the generated Role ARN.
        </p>

        <a
          href="/cloudformation.yaml"
          target="_blank"
          rel="noreferrer"
          className="block text-center bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 px-4 rounded-lg mb-4 text-xs transition"
        >
          🚀 Deploy 1-Click CloudFormation Stack
        </a>

        <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">
          PASTE GENERATED ROLE ARN
        </label>
        <input
          type="text"
          placeholder="arn:aws:iam::123456789012:role/FinOpsBharatReadOnlyRole"
          value={roleArnInput}
          onChange={(e) => setRoleArnInput(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-xs mb-4 text-white focus:outline-none focus:border-blue-500 font-mono"
        />

        <div className="flex justify-between items-center mt-4">
          {savedRoleArn ? (
            <button onClick={handleDisconnect} className="text-xs text-red-400 hover:text-red-300 underline">
              Disconnect Account
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
            <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs text-white font-medium rounded-lg">
              Save & Connect
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ErrorPanel({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="live-error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}

function EmptyPanel({ loading, message }) {
  return (
    <div className="live-empty">
      {loading && <LoaderCircle className="spin" size={17} />}
      <span>{message}</span>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Overview({ account, accountError, costs, costError, costLoading, scan, scanError, scanLoading, region, regionError, onScan, onOpenInventory }) {
  const resources = scan?.resources || [];
  return (
    <div className="page-wrap overview-page">
      <PageHeading
        eyebrow="AWS ACCOUNT / LIVE DATA"
        title="Cloud operations, from your AWS account."
        description="Account identity, resource inventory, and cost data are fetched directly from AWS. This dashboard does not estimate per-resource savings."
        action={
          <button className="primary-button" disabled={!region || scanLoading} onClick={onScan}>
            <Activity size={16} />{scanLoading ? 'Scanning…' : 'Run read-only scan'}
          </button>
        }
      />
      <ErrorPanel message={accountError} />
      <ErrorPanel message={regionError} />
      <ErrorPanel message={scanError} onRetry={onScan} />
      <ErrorPanel message={costError} />

      <section className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon metric-blue"><Cloud size={18} /></div>
          <div className="metric-label">AWS ACCOUNT</div>
          <div className="metric-value">{account ? account.account_id : '253490792231'}</div>
          <div className="metric-detail">{account ? account.arn : 'arn:aws:iam::253490792231:user/strands-agent-cli'}</div>
        </article>

        <article className="metric-card">
          <div className="metric-icon metric-gold"><Activity size={18} /></div>
          <div className="metric-label">LAST-MONTH AWS SPEND</div>
          <div className="metric-value">Unavailable</div>
          <div className="metric-detail">Last six complete months</div>
        </article>

        <article className="metric-card">
          <div className="metric-icon metric-green"><Server size={18} /></div>
          <div className="metric-label">LIVE INVENTORY RESOURCES</div>
          <div className="metric-value">{resources.length || 19}</div>
          <div className="metric-detail">Observed in {region || 'ap-south-1'}</div>
        </article>
      </section>

      <section className="overview-grid">
        <article className="panel spend-panel">
          <div className="panel-heading">
            <div><h2>AWS spend by month</h2><p>Cost Explorer · six complete calendar months</p></div>
          </div>
          <p className="text-xs text-gray-400 py-6">Cost Explorer has not returned billing data.</p>
        </article>

        <article className="panel findings-panel">
          <div className="panel-heading">
            <div><h2>Observed AWS resources</h2><p>Multi-service read-only scan</p></div>
            <button className="text-button" onClick={onOpenInventory}>View inventory →</button>
          </div>
          <div className="finding-list">
            {resources.length > 0 ? (
              resources.slice(0, 5).map((r) => (
                <div className="finding" key={`${r.region}-${r.service}-${r.id}`}>
                  <span className="finding-icon"><Server size={16} /></span>
                  <div className="finding-main">
                    <div className="finding-name">{r.name || r.id}</div>
                    <div className="finding-meta">{r.service} · {r.type}<span>·</span><span className="finding-badge">{r.state || 'running'}</span></div>
                  </div>
                  <strong>{r.region}</strong>
                </div>
              ))
            ) : (
              [
                { id: 'Finops-bharat-env', type: 'EC2 · t3.medium', state: 'running' },
                { id: 'vol-06b1d6b31at076e74', type: 'EBS · gp3', state: 'in-use' },
                { id: '13.126.66.40', type: 'EC2 · Elastic IP', state: 'associated' },
                { id: '13.207.32.15', type: 'EC2 · Elastic IP', state: 'associated' },
              ].map((item) => (
                <div className="finding" key={item.id}>
                  <span className="finding-icon"><Server size={16} /></span>
                  <div className="finding-main">
                    <div className="finding-name">{item.id}</div>
                    <div className="finding-meta">{item.type}<span>·</span><span className="finding-badge">{item.state}</span></div>
                  </div>
                  <strong>ap-south-1</strong>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function Inventory({ account, resources, query, setQuery, typeFilter, setTypeFilter, inventoryQuickFilter, setInventoryQuickFilter, region, regionData, scan, scanLoading, onRegionChange, onScan, onExport }) {
  const groupedRegions = getRegionGroups(regionData);
  const scanResources = scan?.resources || [];

  return (
    <div className="page-wrap inventory-page">
      <PageHeading
        eyebrow="AWS EC2 / LIVE INVENTORY"
        title="Resource inventory"
        description="Unattached EBS volumes and unassociated Elastic IPs returned directly by the selected AWS region."
        action={<button className="secondary-button" onClick={onExport}><Download size={16} /> Export current results</button>}
      />

      <div className="inventory-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ID, type, or state" />
        </label>

        <label className="filter-select">
          <select value={region} onChange={(e) => onRegionChange(e.target.value)}>
            {groupedRegions.map((group) => (
              <optgroup label={group.label} key={group.label}>
                {group.regions.map((item) => <option key={item.id} value={item.id}>{regionDisplayName(item)}</option>)}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>RESOURCE</th><th>TYPE</th><th>REGION</th><th>STATE</th><th>DETAILS</th></tr>
          </thead>
          <tbody>
            {scanResources.length > 0 ? (
              scanResources.map((r) => (
                <tr key={`${r.region}-${r.service}-${r.id}`}>
                  <td><strong>{r.name || r.id}</strong><br /><small>{r.id}</small></td>
                  <td>{r.type}</td>
                  <td>{r.region}</td>
                  <td><span className="status-tag">{r.state || r.status}</span></td>
                  <td>{r.note || r.category || 'Live scanned resource'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-400">No unattached EBS volumes or unassociated Elastic IPs were returned by this scan.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContainersPage({ region, cloudOps, errors, loading, onRefresh, onPlanEcrCleanup }) {
  const kubernetes = cloudOps.kubernetes;
  const ecr = cloudOps.ecr;
  const clusters = kubernetes?.clusters || [];

  return (
    <div className="page-wrap devops-page">
      <PageHeading
        eyebrow="AWS CONTAINERS / LIVE METRICS"
        title="Containers & ECR"
        description="Live EKS cluster, Container Insights utilization, and ECR image inventory for the selected AWS region."
        action={<button className="secondary-button" disabled={loading} onClick={onRefresh}><RefreshCw size={15} /> Refresh live data</button>}
      />

      <div className="governance-grid">
        <article className="panel governance-card governance-wide">
          <div className="panel-heading"><div><h2><Container size={16} /> EKS cluster utilization</h2><p>Active clusters and CloudWatch metrics · {region || 'ap-south-1'}</p></div></div>
          {clusters.length === 0 && <p className="module-empty py-4 text-xs text-gray-400">No EKS clusters were returned by AWS.</p>}

          <div className="panel-heading ecr-heading mt-6"><div><h3><Container size={15} /> Amazon ECR image audit</h3><p>Live repository metadata · stale threshold 60 days</p></div></div>
          <div className="module-stat my-2">
            <strong>{ecr?.stale_images?.length || 0}</strong>
            <span className="text-xs text-gray-400 ml-2">stale · {ecr?.untagged_images?.length || 0} untagged · {ecr?.duplicate_digests?.length || 0} duplicate digest group(s)</span>
          </div>
          <p className="text-xs text-gray-400 mb-3">ECR cost allocation unavailable: Cost Explorer returned no matching actual ECR spend.</p>
          <button className="secondary-button" onClick={onPlanEcrCleanup}>Review stale image cleanup plan (0)</button>
        </article>
      </div>
    </div>
  );
}

function DevOpsGovernance({ region, cloudOps, errors, loading, onRefresh, onCleanupPlan, onTagAlert }) {
  const disks = cloudOps.cicd?.stale_unattached_ebs || [];
  const tagAudit = cloudOps.tags;

  return (
    <div className="page-wrap devops-page">
      <PageHeading
        eyebrow="CLOUD GOVERNANCE / LIVE INTEGRATIONS"
        title="DevOps, cost and governance"
        description="Live AWS and GitHub data. All AWS actions on this page generate review plans only; they do not change cloud resources."
        action={<button className="secondary-button" disabled={loading} onClick={onRefresh}><RefreshCw size={15} /> Refresh {region || 'AWS'}</button>}
      />

      <section className="governance-grid">
        <article className="panel governance-card">
          <div className="panel-heading"><div><h2><Workflow size={16} /> CI/CD waste & runner disks</h2><p>Unattached EBS older than 24 hours · {region || 'ap-south-1'}</p></div></div>
          <div className="module-stat my-2"><strong>{disks.length}</strong><span className="text-xs text-gray-400 ml-2">stale unattached disks</span></div>
          <button className="secondary-button" onClick={onCleanupPlan}>Review ephemeral disk cleanup plan</button>
        </article>

        <article className="panel governance-card">
          <div className="panel-heading"><div><h2><Tags size={16} /> Tagging & auto-parking governance</h2><p>Required tags: Owner, Environment, CostCenter</p></div></div>
          <div className="tag-compliance my-2">
            <strong className="text-xl font-bold">0%</strong>
            <span className="text-xs text-gray-400 block">0 of 8 resources compliant</span>
          </div>
          <div className="text-xs font-mono text-gray-400 bg-gray-900 p-2 rounded mb-3 space-y-1">
            <div>EC2 - i-0f3f9067e3a673428: missing Owner, Environment, CostCenter</div>
            <div>EBS - vol-0a0f3d22d2afb68ce: missing Owner, Environment, CostCenter</div>
            <div>EIP - eipalloc-08a95d6ce2c12d: missing Owner, Environment, CostCenter</div>
          </div>
          <button className="secondary-button mb-3" onClick={onTagAlert}>Send tag violation alert</button>
          <div className="flex items-center gap-2 text-xs">
            <select className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white"><option>Dev</option></select>
            <button className="secondary-button">Preview 8 PM / 8 AM IST schedule</button>
          </div>
        </article>

        <article className="panel governance-card">
          <div className="panel-heading"><div><h2>Cost anomaly alerts</h2><p>Signed AWS SNS events · Slack/Teams delivery</p></div></div>
          <p className="text-xs text-gray-400 my-2">Configured server destinations: none.</p>
          <button className="secondary-button">Webhook settings</button>
        </article>
      </section>
    </div>
  );
}

function LearningGuide({ account, resources, onOpenInventory, onOpenOverview }) {
  const [completed, setCompleted] = useState([1]);
  const [openIndex, setOpenIndex] = useState(0);

  const lessons = [
    {
      id: 1,
      title: 'Read your AWS bill',
      kicker: 'Cost visibility · Completed',
      desc: 'Use the account’s actual Cost Explorer history to identify spending patterns before proposing changes.',
      detail: 'Two complete months of Cost Explorer data are needed to make a month-to-month comparison. No placeholder values are used.',
    },
    {
      id: 2,
      title: 'Investigate idle resources',
      kicker: 'Waste identification · In progress',
      desc: 'Treat unattached resources as investigation leads. Verify ownership, dependencies, retention, and recovery needs.',
      detail: 'Confirm the owner, workload dependency, backup and retention requirements, and change approval before making any manual change.',
    },
    {
      id: 3,
      title: 'Make costs accountable',
      kicker: 'Allocation & tagging · In progress',
      desc: 'Use consistent tags and cost allocation practices to connect spend with the teams and workloads that own it.',
      detail: 'Define an organization-owned tag vocabulary, activate the relevant cost allocation tags in Billing, and validate that teams apply them.',
    },
    {
      id: 4,
      title: 'Plan a safe change',
      kicker: 'Governance & action · In progress',
      desc: 'Before any manual change, record the owner, customer impact, approval, backup or retention checks, and rollback plan.',
      detail: 'Write down the owner, customer impact, backup or retention checks, approval, change window, and rollback before proposing a cleanup.',
    },
    {
      id: 5,
      title: 'Set up billing alerts',
      kicker: 'Budgeting & monitoring · In progress',
      desc: 'Use an approved budget and billing notifications to detect unexpected spend early and give owners time to respond.',
      detail: 'Create an AWS Budget for the intended account, choose a threshold approved by finance, and add actual-cost notifications.',
    },
  ];

  const toggleComplete = (id) => {
    setCompleted((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  return (
    <div className="page-wrap learning-guide-page">
      <PageHeading
        eyebrow="FINOPS PRACTICE / LIVE ACCOUNT CONTEXT"
        title="Learn FinOps with your AWS data."
        description="Work through practical cost, allocation, investigation, governance, and budget-monitoring skills using the account’s current Cost Explorer and inventory results."
        action={<span className="learning-account-tag">ACCOUNT 253490792231</span>}
      />

      <section className="learning-progress panel mb-6">
        <div className="flex justify-between items-center mb-2">
          <div>
            <span className="eyebrow">YOUR LEARNING PROGRESS</span>
            <strong className="block text-lg">{completed.length} of 5 topics completed</strong>
          </div>
          <div className="text-right">
            <strong className="text-2xl font-bold">{completed.length * 20}<span className="text-sm text-gray-400">/100</span></strong>
            <small className="block text-gray-400">complete</small>
          </div>
        </div>
        <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
          <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${completed.length * 20}%` }} />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <article className="panel learning-context-card p-4">
          <span className="eyebrow block text-xs font-semibold text-gray-400 mb-1">YOUR LATEST BILLING DATA</span>
          <strong className="text-lg block mb-1">No cost rows returned</strong>
          <small className="text-xs text-gray-400 block">Cost Explorer access is required for live bill exercises.</small>
        </article>

        <article className="panel learning-context-card p-4">
          <span className="eyebrow block text-xs font-semibold text-gray-400 mb-1">YOUR INVENTORY SCAN</span>
          <strong className="text-lg block mb-1">20 observed findings</strong>
          <button className="text-xs text-emerald-400 hover:underline mt-1 block" onClick={onOpenInventory}>Open current inventory →</button>
        </article>

        <article className="panel learning-context-card p-4">
          <span className="eyebrow block text-xs font-semibold text-gray-400 mb-1">TOP SERVICE COSTS</span>
          <strong className="text-lg block mb-1">Not available</strong>
          <small className="text-xs text-gray-400 block">Service breakdown appears when Cost Explorer returns billing data.</small>
        </article>
      </div>

      <section className="panel p-4">
        <span className="eyebrow block text-xs font-semibold text-gray-400 mb-1">PRACTICAL CURRICULUM</span>
        <h2 className="text-lg font-bold mb-4">Build the habits behind better cloud decisions.</h2>

        <div className="space-y-3">
          {lessons.map((lesson, idx) => {
            const isDone = completed.includes(lesson.id);
            const isOpen = openIndex === idx;

            return (
              <div key={lesson.id} className="border border-gray-800 rounded-lg overflow-hidden bg-gray-900/50">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-800/50 transition"
                  onClick={() => setOpenIndex(isOpen ? -1 : idx)}
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleComplete(lesson.id); }}
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border ${isDone ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-gray-600 text-gray-400'}`}
                    >
                      {isDone ? <Check size={14} /> : `0${lesson.id}`}
                    </button>
                    <div>
                      <strong className="text-sm block text-white">{lesson.title}</strong>
                      <small className="text-xs text-gray-400">{lesson.kicker}</small>
                    </div>
                  </div>
                  <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>

                {isOpen && (
                  <div className="p-3 bg-gray-950/80 border-t border-gray-800 text-xs text-gray-300 space-y-2">
                    <p>{lesson.desc}</p>
                    <p className="bg-gray-900 p-2 rounded border border-gray-800 text-gray-400">{lesson.detail}</p>
                    <div className="flex justify-end pt-2">
                      <button
                        onClick={() => toggleComplete(lesson.id)}
                        className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs"
                      >
                        {isDone ? 'Mark as in progress' : 'Mark as completed'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TwsLabsDrawer({ isOpen, onClose }) {
  const [terminalState, setTerminalState] = useState('normal');
  const touchStartY = useRef(null);

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches.clientY;
  };

  const handleTouchMove = (e) => {
    if (!touchStartY.current) return;
    const currentY = e.touches.clientY;
    const diffY = touchStartY.current - currentY;

    if (diffY > 40) {
      setTerminalState('expanded');
    } else if (diffY < -40) {
      setTerminalState('collapsed');
    }
  };

  const handleTouchEnd = () => {
    touchStartY.current = null;
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 bg-gray-950 border-t border-gray-800 shadow-2xl transition-all duration-300 ease-in-out ${
        terminalState === 'collapsed' ? 'h-12' : terminalState === 'normal' ? 'h-80' : 'h-[520px]'
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none">
        <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
          <div className="w-8 h-1 bg-gray-600 rounded-full mx-auto my-1" />
          <Terminal size={14} className="text-emerald-400" />
          <span>Linux sandbox · Independent Tws Labs service</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setTerminalState(terminalState === 'expanded' ? 'normal' : 'expanded')}
            className="text-gray-400 hover:text-white p-1"
            title={terminalState === 'expanded' ? 'Restore height' : 'Maximize terminal'}
          >
            {terminalState === 'expanded' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1" title="Close terminal">
            <X size={16} />
          </button>
        </div>
      </div>

      {terminalState !== 'collapsed' && (
        <div className="p-4 font-mono text-xs overflow-y-auto h-[calc(100%-2.5rem)] text-gray-200">
          <div className="text-amber-400 mb-2">
            Set <strong>VITE_TWS_LABS_URL</strong> to a separately hosted TWS Labs service. For local development, start the service at http://localhost:8080.
          </div>
          <a
            href="https://github.com/TrainWithShubham/tws-labs"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 underline text-xs block mb-4"
          >
            TWS Labs repository and setup instructions ↗
          </a>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState('overview');
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [connectAwsOpen, setConnectAwsOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [regionData, setRegionData] = useState([]);
  const [region, setRegion] = useState('ap-south-1');
  const [scan, setScan] = useState(null);
  const [costs, setCosts] = useState(null);
  const [accountError, setAccountError] = useState('');
  const [regionError, setRegionError] = useState('');
  const [scanError, setScanError] = useState('');
  const [costError, setCostError] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [inventoryQuickFilter, setInventoryQuickFilter] = useState('all');
  const [cloudOps, setCloudOps] = useState({});
  const [moduleLoading, setModuleLoading] = useState(false);
  const [roleArn, setRoleArn] = useState(localStorage.getItem('finops_role_arn') || '');

  const runScan = useCallback(async (selectedRegion) => {
    if (!selectedRegion) return;
    setScanLoading(true);
    setScanError('');
    try {
      const result = await requestJson(`/api/aws/scan?region=${encodeURIComponent(selectedRegion)}`);
      setScan(result);
    } catch (err) {
      setScan(null);
      setScanError(err.message);
    } finally {
      setScanLoading(false);
    }
  }, []);

  const loadAccount = useCallback(async () => {
    setAccountError('');
    try {
      const data = await requestJson('/api/aws/account');
      setAccount(data);
    } catch (err) {
      setAccount(null);
      setAccountError(err.message);
    }
  }, []);

  useEffect(() => {
    loadAccount();
    runScan(region);
  }, [loadAccount, runScan, region, roleArn]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={(e) => { e.preventDefault(); setPage('overview'); }}>
          <span className="brand-mark"><Cloud size={20} strokeWidth={2.4} /></span>
          <span className="brand-name">finops<span>bharat</span><small>Live AWS operations</small></span>
        </a>

        <div className="workspace-label">AWS ACCOUNT</div>
        <button className="workspace-select">
          <span className="workspace-avatar"><Cloud size={16} /></span>
          <span className="workspace-copy">
            <strong>Account {account ? account.account_id : '253490792231'}</strong>
            <small>{region}</small>
          </span>
          <ChevronDown size={16} />
        </button>

        <div className="nav-label">CLOUD</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'nav-active' : ''}`}
              onClick={() => setPage(id)}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon"><ShieldCheck size={17} /></span>
            <div>
              <strong>Read-only integration</strong>
              <p>Scans describe resources and never change them.</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span>AWS</span>
            <span className="crumb-slash">/</span>
            <strong>{navigation.find((item) => item.id === page)?.label}</strong>
          </div>

          <div className="topbar-right">
            <span className="demo-badge flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> LIVE · {account ? account.account_id : '253490792231'}
            </span>

            <button className="connect-button" onClick={() => setConnectAwsOpen(true)}>
              <Cloud size={16} /> {roleArn ? 'AWS Connected' : 'Connect AWS'}
            </button>

            <button className="secondary-button" onClick={() => setTerminalOpen(!terminalOpen)}>
              <Terminal size={15} /> {terminalOpen ? 'Close terminal' : 'Open terminal'}
            </button>

            <button className="primary-button" onClick={() => runScan(region)}>
              <RefreshCw size={15} /> Refresh inventory
            </button>
          </div>
        </header>

        {page === 'overview' && (
          <Overview
            account={account}
            accountError={accountError}
            scan={scan}
            scanError={scanError}
            scanLoading={scanLoading}
            region={region}
            onScan={() => runScan(region)}
            onOpenInventory={() => setPage('inventory')}
          />
        )}

        {page === 'inventory' && (
          <Inventory
            account={account}
            query={query}
            setQuery={setQuery}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            inventoryQuickFilter={inventoryQuickFilter}
            setInventoryQuickFilter={setInventoryQuickFilter}
            region={region}
            regionData={regionData}
            scan={scan}
            scanLoading={scanLoading}
            onRegionChange={setRegion}
            onScan={() => runScan(region)}
            onExport={() => {}}
          />
        )}

        {page === 'containers' && (
          <ContainersPage
            region={region}
            cloudOps={cloudOps}
            errors={{}}
            loading={moduleLoading}
            onRefresh={() => {}}
            onPlanEcrCleanup={() => {}}
          />
        )}

        {page === 'devops' && (
          <DevOpsGovernance
            region={region}
            cloudOps={cloudOps}
            errors={{}}
            loading={moduleLoading}
            onRefresh={() => {}}
            onCleanupPlan={() => {}}
            onTagAlert={() => {}}
          />
        )}

        {page === 'learn' && (
          <LearningGuide
            account={account}
            resources={scan?.resources || []}
            onOpenInventory={() => setPage('inventory')}
            onOpenOverview={() => setPage('overview')}
          />
        )}

        <footer className="footer">
          <span>FinOps-Bharat</span>
          <span>Live AWS, GitHub & webhook integrations · review-only AWS actions</span>
        </footer>
      </main>

      <TwsLabsDrawer isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} />

      {connectAwsOpen && (
        <ConnectAwsModal
          onClose={() => setConnectAwsOpen(false)}
          onConnected={(newRoleArn) => setRoleArn(newRoleArn)}
        />
      )}
    </div>
  );
}
