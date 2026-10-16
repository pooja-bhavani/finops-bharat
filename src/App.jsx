import React, { lazy, Suspense, useMemo, useState, useEffect, useRef } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronUp,
  CircleHelp, Cloud, Download, ExternalLink, Filter, IndianRupee, Leaf,
  LayoutDashboard, ListFilter, Maximize2, Minimize2, Menu, Search, Server,
  ShieldCheck, Sparkles, Terminal, X,
} from 'lucide-react';

const SpendChart = lazy(() => import('./SpendChart.jsx'));

const initialResources = [
  { id: 'vol-0e51', name: 'legacy-api-data', type: 'EBS volume', region: 'ap-south-1', status: 'Unattached', age: '42 days', monthly: 1840, note: 'No attached instance. Snapshot before removal.' },
  { id: 'eip-091a', name: 'staging-address-2', type: 'Elastic IP', region: 'ap-south-1', status: 'Unassociated', age: '19 days', monthly: 310, note: 'Public IPv4 address is not associated with a resource.' },
  { id: 'snap-72c4', name: 'old-ci-runner-root', type: 'EBS snapshot', region: 'ap-south-1', status: 'Older than 90 days', age: '128 days', monthly: 960, note: 'Review retention policy and recovery requirements.' },
  { id: 'vol-13d8', name: 'qa-db-volume', type: 'EBS volume', region: 'ap-south-1', status: 'Unattached', age: '31 days', monthly: 1260, note: 'No attachment found in the latest sample scan.' },
  { id: 'i-0b1f', name: 'batch-worker-dev', type: 'EC2 instance', region: 'ap-south-1', status: 'Low utilization', age: '14 days', monthly: 7480, note: 'Sample recommendation: inspect CloudWatch before resizing.' },
  { id: 'snap-5f29', name: 'pre-release-backup', type: 'EBS snapshot', region: 'ap-south-1', status: 'Review retention', age: '96 days', monthly: 740, note: 'Confirm compliance and restore-point requirements first.' },
];

const spend = [
  { month: 'May', spend: 384000, forecast: 384000 },
  { month: 'Jun', spend: 401000, forecast: 401000 },
  { month: 'Jul', spend: 393000, forecast: 393000 },
  { month: 'Aug', spend: 428000, forecast: 428000 },
  { month: 'Sep', spend: 446000, forecast: 446000 },
  { month: 'Oct', spend: 421000, forecast: 458000 },
];

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', label: 'Resource inventory', icon: Server },
  { id: 'terminal', label: 'TWS Terminal Labs', icon: Terminal },
  { id: 'learn', label: 'Learn FinOps', icon: BookOpen },
];

const money = (value) => `₹${new Intl.NumberFormat('en-IN').format(value)}`;

export default function App() {
  const [page, setPage] = useState('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All resources');
  const [dialog, setDialog] = useState('');
  const [toast, setToast] = useState('');
  const [scannedAt, setScannedAt] = useState('Today, 09:41 IST');
  const [command, setCommand] = useState('');
  const [terminalLines, setTerminalLines] = useState([
    { kind: 'system', text: 'FinOps-Bharat practice console · simulated environment' },
    { kind: 'system', text: 'Type help to see available practice commands.' },
  ]);
  const [mobileNav, setMobileNav] = useState(false);

  // Live AWS Connection State
  const [roleArn, setRoleArn] = useState(localStorage.getItem('finops_role_arn') || '');
  const [inputArn, setInputArn] = useState('');
  const [scanData, setScanData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState('');

  // Swipeable Terminal Sheet State ('collapsed' | 'normal' | 'expanded')
  const [terminalState, setTerminalState] = useState('collapsed');
  const touchStartY = useRef(null);

  // Fetch Live Data from FastAPI Backend
  const fetchScanData = async (arn) => {
    if (!arn) return;
    setLoading(true);
    setScanError('');
    try {
      const res = await fetch('/api/scan', {
        headers: { 'x-aws-role-arn': arn }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Scan failed');
      setScanData(data);
      const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date());
      setScannedAt(`Today, ${time} IST`);
    } catch (err) {
      setScanError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (roleArn) fetchScanData(roleArn);
  }, [roleArn]);

  const handleConnectRole = () => {
    if (!inputArn.trim()) return;
    const cleanArn = inputArn.trim();
    localStorage.setItem('finops_role_arn', cleanArn);
    setRoleArn(cleanArn);
    setDialog('');
    notify('Role ARN saved! Scanning live AWS infrastructure...');
  };

  const handleDisconnectRole = () => {
    localStorage.removeItem('finops_role_arn');
    setRoleArn('');
    setScanData(null);
    notify('Disconnected from custom AWS Account.');
  };

  const visibleResources = useMemo(() => {
    const list = (scanData && scanData.idle_ec2) 
      ? scanData.idle_ec2.map(i => ({ id: i.id, name: i.id, type: 'EC2 instance', region: 'ap-south-1', status: i.state, age: 'Active', monthly: 7480, note: 'Live scanned resource' }))
      : initialResources;

    return list.filter((resource) => {
      const matchesQuery = `${resource.name} ${resource.type} ${resource.id} ${resource.region}`.toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === 'All resources' || resource.type === filter;
      return matchesQuery && matchesFilter;
    });
  }, [scanData, query, filter]);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  };

  const runDemoScan = () => {
    if (roleArn) {
      fetchScanData(roleArn);
    } else {
      const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date());
      setScannedAt(`Today, ${time} IST`);
      notify('Demo refreshed. Connect AWS role for live data.');
    }
  };

  const exportCsv = () => {
    const rows = [
      ['Resource ID', 'Name', 'Type', 'Region', 'Finding', 'Estimated monthly opportunity (INR)'],
      ...visibleResources.map(r => [r.id, r.name, r.type, r.region, r.status, r.monthly])
    ].map(e => e.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');

    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv;charset=utf-8' }));
    link.download = 'finops-bharat-inventory.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    notify('Inventory exported as CSV.');
  };

  const submitCommand = (event) => {
    event.preventDefault();
    const input = command.trim();
    if (!input) return;
    const outputs = {
      help: ['Available: help, ls, finops scan, finops report, clear', 'This is a live terminal sandbox interaction.'],
      ls: ['README.md  cloudformation.yaml  backend/  src/'],
      'finops scan': [roleArn ? `Live scan active for ${roleArn.slice(0, 20)}...` : 'Demo scan complete: 6 sample recommendations found.'],
      'finops report': ['Potential monthly opportunity: ₹12,590.', 'Review resource retention and CloudWatch telemetry.'],
    };

    if (input === 'clear') {
      setTerminalLines([]);
    } else {
      setTerminalLines((lines) => [
        ...lines,
        { kind: 'input', text: `learner@finops-bharat:~$ ${input}` },
        ...(outputs[input] || ['Command not found in simulation. Type help.']).map((text) => ({ kind: 'output', text }))
      ]);
    }
    setCommand('');
  };

  // Touch Swipe Gesture Handlers
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

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setPage('overview'); }}>
          <span className="brand-mark"><Cloud size={20} strokeWidth={2.4} /></span>
          <span className="brand-name">finops<span>bharat</span><small>Cloud efficiency, in focus</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-select" onClick={() => setDialog('account')}>
          <span className="workspace-avatar">GS</span>
          <span className="workspace-copy">
            <strong>{roleArn ? 'Live AWS Account' : 'Greenfield Systems'}</strong>
            <small>{roleArn ? `${roleArn.slice(0, 18)}...` : 'Demo account · ap-south-1'}</small>
          </span>
          <ChevronDown size={16} />
        </button>

        <div className="nav-label">MONITOR</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${page === id ? 'nav-active' : ''}`}
              key={id}
              onClick={() => { setPage(id); setMobileNav(false); if (id === 'terminal') setTerminalState('expanded'); }}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === 'inventory' && <span className="nav-count">{visibleResources.length}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon"><ShieldCheck size={17} /></span>
            <div>
              <strong>Read-only by design</strong>
              <p>Scans describe resources and never change them.</p>
            </div>
          </div>

          <button className="help-link" onClick={() => setDialog('aws')}>
            <CircleHelp size={16} /> AWS connection guide <ArrowUpRight size={14} />
          </button>

          <div className="profile">
            <span className="profile-avatar">PB</span>
            <span>
              <strong>Pooja B.</strong>
              <small>FinOps analyst</small>
            </span>
            <button title="Profile settings" aria-label="Profile settings" onClick={() => notify('Profile settings are active.')}>
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </aside>

      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <main className="main-content">
        {/* Top Header */}
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}>
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>{navItems.find((item) => item.id === page)?.label}</strong>
          </div>

          <div className="topbar-right">
            {roleArn ? (
              <div className="flex items-center gap-2">
                <span className="demo-badge text-emerald-400">
                  <span className="bg-emerald-500" /> LIVE CONNECTED
                </span>
                <button onClick={handleDisconnectRole} className="text-xs text-red-400 hover:text-red-300 ml-2">
                  Disconnect
                </button>
              </div>
            ) : (
              <span className="demo-badge">
                <span /> DEMO MODE
              </span>
            )}

            <button className="connect-button" onClick={() => setDialog('aws')}>
              <Cloud size={16} /> {roleArn ? 'Account Settings' : 'Connect AWS'}
            </button>
          </div>
        </header>

        {loading && (
          <div className="bg-blue-900/30 border border-blue-500/40 text-blue-200 text-xs px-4 py-2 mx-8 mt-4 rounded-lg flex items-center gap-2">
            <Activity className="animate-spin" size={14} /> Fetching live AWS infrastructure scan...
          </div>
        )}

        {scanError && (
          <div className="bg-red-900/30 border border-red-500/40 text-red-300 text-xs px-4 py-2 mx-8 mt-4 rounded-lg">
            ⚠️ Scan Error: {scanError}
          </div>
        )}

        {page === 'overview' && (
          <Overview scannedAt={scannedAt} onScan={runDemoScan} onNavigate={setPage} onReview={() => setDialog('cleanup')} />
        )}
        {page === 'inventory' && (
          <Inventory resources={visibleResources} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onExport={exportCsv} onReview={() => setDialog('cleanup')} />
        )}
        {page === 'terminal' && (
          <TerminalLab command={command} setCommand={setCommand} terminalLines={terminalLines} onSubmit={submitCommand} setTerminalState={setTerminalState} />
        )}
        {page === 'learn' && (
          <Learn command={command} setCommand={setCommand} terminalLines={terminalLines} onSubmit={submitCommand} />
        )}

        <footer className="footer">
          <span>FinOps-Bharat <span className="footer-dot">·</span> AWS Cloud Governance</span>
          <span>
            {roleArn ? 'Live AWS Session Active' : 'Indicative sample estimates only'}{' '}
            <span className="footer-dot">·</span>{' '}
            <button onClick={() => setDialog('methodology')}>Methodology</button>
          </span>
        </footer>
      </main>

      {/* Swipeable Terminal Drawer */}
      <div 
        className={`fixed bottom-0 left-0 right-0 z-40 bg-gray-950 border-t border-gray-800 transition-all duration-300 ease-in-out shadow-2xl ${
          terminalState === 'collapsed' ? 'h-12' : terminalState === 'normal' ? 'h-64' : 'h-3/4'
        }`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 cursor-grab active:cursor-grabbing select-none">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
            <div className="w-8 h-1 bg-gray-600 rounded-full mx-auto my-1" />
            <Terminal size={14} className="text-emerald-400" />
            <span>Interactive FinOps Terminal</span>
          </div>

          <div className="flex items-center gap-2">
            {terminalState === 'collapsed' ? (
              <button onClick={() => setTerminalState('normal')} className="text-gray-400 hover:text-white p-1" title="Swipe Up / Expand">
                <ChevronUp size={16} />
              </button>
            ) : (
              <>
                <button 
                  onClick={() => setTerminalState(terminalState === 'expanded' ? 'normal' : 'expanded')} 
                  className="text-gray-400 hover:text-white p-1"
                  title={terminalState === 'expanded' ? 'Restore Height' : 'Maximize Terminal'}
                >
                  {terminalState === 'expanded' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
                <button onClick={() => setTerminalState('collapsed')} className="text-gray-400 hover:text-white p-1" title="Swipe Down / Collapse">
                  <ChevronDown size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        {terminalState !== 'collapsed' && (
          <div className="p-4 font-mono text-xs overflow-y-auto h-[calc(100%-3rem)] text-gray-200">
            <div className="mb-3 text-emerald-400">
              FinOps-Bharat Live Sandbox Terminal v1.0.0 (Swipe handle to resize)
            </div>
            {terminalLines.map((line, idx) => (
              <div key={idx} className={`mb-1 ${line.kind === 'input' ? 'text-amber-300' : 'text-gray-300'}`}>
                {line.text}
              </div>
            ))}
            <form onSubmit={submitCommand} className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-800">
              <span className="text-emerald-400 font-bold">›</span>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Type command (help, finops scan, clear)..."
                className="flex-1 bg-transparent text-white outline-none border-none font-mono text-xs"
              />
            </form>
          </div>
        )}
      </div>

      {/* CloudFormation Connection Modal */}
      {dialog === 'aws' && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setDialog('')}>
          <section className="modal" role="dialog" aria-modal="true">
            <button className="modal-close" onClick={() => setDialog('')}><X size={18} /></button>
            <span className="eyebrow">AWS CROSS-ACCOUNT SETUP</span>
            <h2>Connect Your AWS Account (Zero-Keys Required)</h2>
            <p className="text-xs text-gray-300 mb-4">
              Deploy our read-only CloudFormation stack in your AWS console. No access keys or secrets leave your account.
            </p>

            <button
              onClick={() => window.open('/cloudformation.yaml', '_blank')}
              className="w-full text-center bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 px-4 rounded-lg mb-4 text-xs transition"
            >
              🚀 Deploy CloudFormation Stack in AWS Console
            </button>

            <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">
              Paste Generated Role ARN:
            </label>
            <input
              type="text"
              placeholder="arn:aws:iam::123456789012:role/FinOpsBharatReadOnlyRole"
              value={inputArn}
              onChange={(e) => setInputArn(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-xs mb-4 text-white focus:outline-none focus:border-blue-500"
            />

            <div className="flex justify-end gap-2">
              <button onClick={() => setDialog('')} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button onClick={handleConnectRole} className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs text-white font-medium rounded-lg">Save & Connect</button>
            </div>
          </section>
        </div>
      )}

      {dialog && dialog !== 'aws' && <Dialog type={dialog} onClose={() => setDialog('')} onNotify={notify} />}
      {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
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

function Overview({ scannedAt, onScan, onNavigate, onReview }) {
  return (
    <div className="page-wrap overview-page">
      <PageHeading
        eyebrow="FINOPS OVERVIEW / OCTOBER 2026"
        title="Make every rupee work harder."
        description="A clearer view of cloud spend, idle capacity, and the opportunity to do better."
        action={
          <button className="primary-button" onClick={onScan}>
            <Activity size={16} /> Refresh scan
          </button>
        }
      />
      <div className="scan-strip">
        <span className="scan-pulse" /> Inventory last refreshed <strong>{scannedAt}</strong>
      </div>

      <section className="metric-grid" aria-label="Cloud efficiency metrics">
        <MetricCard label="MONTHLY CLOUD SPEND" value="₹4,21,000" detail="October estimate" icon={IndianRupee} tone="green" trend={<><ArrowDownRight size={14} /> 5.6% <span>vs. last month</span></>} />
        <MetricCard label="POTENTIAL MONTHLY SAVINGS" value="₹12,590" detail="Across idle findings" icon={Sparkles} tone="gold" trend={<span className="neutral-trend">Review required</span>} />
        <MetricCard label="EMISSIONS OPPORTUNITY" value="2.4 tCO₂e" detail="Indicative, not measured" icon={Leaf} tone="blue" trend={<span className="neutral-trend">Estimate</span>} />
      </section>

      <section className="overview-grid">
        <article className="panel spend-panel">
          <div className="panel-heading">
            <div><h2>Spend trajectory</h2><p>Monthly cloud spend · Indian rupees</p></div>
            <button className="select-control" aria-label="Current period">Last 6 months <ChevronDown size={14} /></button>
          </div>
          <div className="chart-summary"><strong>₹4.21L</strong><span><ArrowDownRight size={15} /> 5.6%</span><small>October vs. September</small></div>
          <Suspense fallback={<div className="chart-loading">Loading spend chart...</div>}>
            <SpendChart data={spend} money={money} />
          </Suspense>
        </article>

        <article className="panel findings-panel">
          <div className="panel-heading">
            <div><h2>Where to look first</h2><p>Prioritised recommendations</p></div>
            <button className="text-button" onClick={() => onNavigate('inventory')}>View all <ArrowUpRight size={14} /></button>
          </div>
          <div className="finding-list">
            <Finding type="EBS volume" name="legacy-api-data" amount="₹1,840" badge="Unattached" icon={Server} />
            <Finding type="EC2 instance" name="batch-worker-dev" amount="₹7,480" badge="Low utilization" icon={Activity} />
            <Finding type="EBS snapshot" name="old-ci-runner-root" amount="₹960" badge="Review retention" icon={Cloud} />
          </div>
          <button className="review-button" onClick={onReview}>Review cleanup plan <ArrowUpRight size={15} /></button>
        </article>
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone, trend }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-${tone}`}><Icon size={18} strokeWidth={1.8} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
      <div className="metric-trend">{trend}</div>
    </article>
  );
}

function Finding({ type, name, amount, badge, icon: Icon }) {
  return (
    <div className="finding">
      <span className="finding-icon"><Icon size={16} /></span>
      <div className="finding-main">
        <div className="finding-name">{name}</div>
        <div className="finding-meta">{type}<span>·</span><span className="finding-badge">{badge}</span></div>
      </div>
      <strong>{amount}<small>/mo</small></strong>
    </div>
  );
}

function Inventory({ resources, query, setQuery, filter, setFilter, onExport, onReview }) {
  const filters = ['All resources', 'EBS volume', 'EBS snapshot', 'EC2 instance', 'Elastic IP'];
  return (
    <div className="page-wrap inventory-page">
      <PageHeading eyebrow="CLOUD ASSETS" title="Resource inventory" description="Find potential waste, inspect evidence, and decide what deserves a closer look." action={<button className="secondary-button" onClick={onExport}><Download size={16} /> Export CSV</button>} />
      <div className="inventory-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search resources..." />
        </label>
        <label className="filter-select">
          <ListFilter size={16} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {filters.map(f => <option key={f}>{f}</option>)}
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>RESOURCE</th><th>TYPE</th><th>REGION</th><th>FINDING</th><th>AGE</th><th className="align-right">EST. OPPORTUNITY</th></tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong><br /><small className="text-gray-400">{r.id}</small></td>
                <td>{r.type}</td>
                <td>{r.region}</td>
                <td><span className="status-tag">{r.status}</span></td>
                <td>{r.age}</td>
                <td className="align-right"><strong>{money(r.monthly)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Learn({ command, setCommand, terminalLines, onSubmit }) {
  return (
    <div className="page-wrap learn-page">
      <PageHeading eyebrow="LEARNING / PRACTICE" title="Build the instincts behind the savings." description="Learn to investigate cloud waste and make safer decisions." />
      <div className="practice-card mt-6">
        <p className="text-xs text-gray-400 mb-2">Use the bottom terminal drawer (swipe up to expand) to interact with live commands!</p>
      </div>
    </div>
  );
}

function Dialog({ type, onClose, onNotify }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <span className="eyebrow">INFO</span>
        <h2>Information Notice</h2>
        <p className="text-xs text-gray-300">Settings and information panel.</p>
        <button className="primary-button modal-action" onClick={onClose}>Close</button>
      </section>
    </div>
  );
}


function TerminalLab({ command, setCommand, terminalLines, onSubmit, setTerminalState }) {
  return (
    <div className="page-wrap terminal-page">
      <PageHeading
        eyebrow="HANDS-ON LABS / TWS TERMINAL"
        title="TWS Live Terminal Labs"
        description="Run real-time FinOps audits, AWS CLI queries, and cost reclamation commands in a simulated sandbox environment."
        action={
          <button className="primary-button" onClick={() => setTerminalState('expanded')}>
            <Terminal size={16} /> Maximize Terminal
          </button>
        }
      />
      <div className="practice-card mt-6 bg-gray-900 border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 text-emerald-400 font-mono text-sm mb-4">
          <Terminal size={18} />
          <strong>FinOps-Bharat Interactive Terminal Environment</strong>
        </div>
        <p className="text-xs text-gray-300 mb-4">
          Execute live audit and cleanup commands below or use the bottom terminal drawer to inspect AWS resource states, unattached EBS volumes, and cost recommendations.
        </p>
        <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs text-gray-200 border border-gray-800 min-h-[220px]">
          <div className="mb-3 text-emerald-400 font-bold">
            FinOps-Bharat Practice Sandbox Console v1.0.0
          </div>
          {terminalLines.map((line, idx) => (
            <div key={idx} className={`mb-1 ${line.kind === 'input' ? 'text-amber-300' : 'text-gray-300'}`}>
              {line.text}
            </div>
          ))}
          <form onSubmit={onSubmit} className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-800">
            <span className="text-emerald-400 font-bold">›</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Type command (help, finops scan, finops report, clear)..."
              className="flex-1 bg-transparent text-white outline-none border-none font-mono text-xs"
            />
          </form>
        </div>
      </div>
    </div>
  );
}
