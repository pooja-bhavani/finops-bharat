import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';

const CATEGORY_COLORS = ['#138808', '#d18a29', '#3b68a0', '#8a6bb8', '#168b91', '#9b6d48', '#758078'];
const STATUS_COLORS = ['#138808', '#d18a29'];

export default function SpendChart({ data, currency }) {
  const money = (value) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    } catch {
      return `${value} ${currency}`;
    }
  };
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#138808" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#138808" stopOpacity={0.015} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e7e9e2" strokeDasharray="3 4" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#7e847d', fontSize: 11 }} dy={10} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: '#7e847d', fontSize: 10 }} tickFormatter={(value) => money(value)} />
          <Tooltip formatter={(value) => [money(value), 'AWS spend']} contentStyle={{ border: '1px solid #e2e6df', borderRadius: 4, fontFamily: 'DM Sans', fontSize: 12 }} />
          <Area type="monotone" dataKey="spend" stroke="#138808" strokeWidth={2.5} fill="url(#spendFill)" activeDot={{ r: 4, fill: '#138808', stroke: '#fff', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InventoryCharts({ resources }) {
  const categoryCounts = new Map();
  let activeCount = 0;
  let idleCount = 0;
  for (const resource of resources) {
    const category = resource.category === 'Database' ? 'Databases' : resource.category || 'Other';
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    const state = String(resource.state || resource.status || '').toLowerCase();
    if (resource.is_waste_candidate || ['stopped', 'idle', 'unattached', 'unassociated', 'failed'].includes(state)) {
      idleCount += 1;
    } else {
      activeCount += 1;
    }
  }
  const categoryData = [...categoryCounts].map(([name, value]) => ({ name, value }));
  const stateData = [
    { name: 'Active / observed', value: activeCount },
    { name: 'Idle / waste candidate', value: idleCount },
  ].filter((item) => item.value > 0);

  return (
    <div className="inventory-chart-grid">
      <article className="panel inventory-chart-panel">
        <div className="panel-heading"><div><h2>Resources by category</h2><p>Observed inventory count · hover for breakdown</p></div></div>
        {categoryData.length
          ? <div className="inventory-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={47} outerRadius={78} paddingAngle={2}>
                  {categoryData.map((item, index) => <Cell key={item.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} resource${value === 1 ? '' : 's'}`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="inventory-chart-legend">{categoryData.map((item, index) => <span key={item.name}><i style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />{item.name}<strong>{item.value}</strong></span>)}</div>
          </div>
          : <div className="inventory-chart-empty">Run a scan to chart observed AWS resources.</div>}
      </article>
      <article className="panel inventory-chart-panel">
        <div className="panel-heading"><div><h2>Active vs. idle / waste candidates</h2><p>Candidate flags are heuristic, not deletion recommendations</p></div></div>
        {stateData.length
          ? <div className="inventory-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={stateData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={47} outerRadius={78} paddingAngle={2}>
                  {stateData.map((item, index) => <Cell key={item.name} fill={STATUS_COLORS[index]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} resource${value === 1 ? '' : 's'}`, name]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="inventory-chart-legend">{stateData.map((item, index) => <span key={item.name}><i style={{ background: STATUS_COLORS[index] }} />{item.name}<strong>{item.value}</strong></span>)}</div>
          </div>
          : <div className="inventory-chart-empty">No resources are currently in the scan result.</div>}
      </article>
    </div>
  );
}