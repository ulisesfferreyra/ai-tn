// pages/dashboard.js
import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Dashboard() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [client, setClient] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);

  // Verificar si ya está logueado
  useEffect(() => {
    const token = localStorage.getItem('dashboard_token');
    if (token) {
      fetchMetrics(token);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchMetrics = async (token) => {
    try {
      const res = await fetch('/api/metrics', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        setClient(data.client);
        setMetrics(data.metrics);
        setRecentEvents(data.recentEvents || []);
        setIsLoggedIn(true);
      } else {
        localStorage.removeItem('dashboard_token');
      }
    } catch (err) {
      console.error('Error fetching metrics:', err);
    }
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem('dashboard_token', data.token);
        setClient(data.client);
        await fetchMetrics(data.token);
      } else {
        setError(data.error || 'Error de autenticación');
      }
    } catch (err) {
      setError('Error de conexión');
    }
    setLoginLoading(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('dashboard_token');
    setIsLoggedIn(false);
    setClient(null);
    setMetrics(null);
  };

  const refreshMetrics = () => {
    const token = localStorage.getItem('dashboard_token');
    if (token) {
      setLoading(true);
      fetchMetrics(token);
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p>Cargando...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <>
        <Head>
          <title>Dashboard - AI Try-On</title>
        </Head>
        <div style={styles.loginContainer}>
          <div style={styles.loginBox}>
            <h1 style={styles.loginTitle}>🎨 AI Try-On</h1>
            <p style={styles.loginSubtitle}>Dashboard de Métricas</p>
            
            <form onSubmit={handleLogin} style={styles.form}>
              <input
                type="text"
                placeholder="Usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={styles.input}
                required
              />
              <input
                type="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                required
              />
              {error && <p style={styles.error}>{error}</p>}
              <button 
                type="submit" 
                style={styles.button}
                disabled={loginLoading}
              >
                {loginLoading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Dashboard - {client?.name || 'AI Try-On'}</title>
      </Head>
      <div style={styles.dashboard}>
        {/* Header */}
        <header style={styles.header}>
          <div>
            <h1 style={styles.headerTitle}>🎨 AI Try-On Dashboard</h1>
            <p style={styles.headerSubtitle}>{client?.name} ({client?.domain})</p>
          </div>
          <div style={styles.headerActions}>
            <button onClick={refreshMetrics} style={styles.refreshBtn}>🔄 Actualizar</button>
            <button onClick={handleLogout} style={styles.logoutBtn}>Cerrar sesión</button>
          </div>
        </header>

        {/* Stats Cards */}
        <div style={styles.statsGrid}>
          <StatCard
            icon="🎯"
            title="Total Generaciones"
            value={metrics?.totalGenerations || 0}
            subtitle={`${metrics?.totalGenerations || 0} en total`}
            color="#3b82f6"
          />
          <StatCard
            icon="✅"
            title="Tasa de Éxito"
            value={`${metrics?.successRate || 0}%`}
            subtitle={`${metrics?.errors || 0} errores totales`}
            color="#22c55e"
          />
          <StatCard
            icon="⚡"
            title="Tiempo Promedio"
            value={`${((metrics?.avgDuration || 0) / 1000).toFixed(1)}s`}
            subtitle={`${metrics?.avgDuration || 0} milisegundos`}
            color="#f59e0b"
          />
          <StatCard
            icon="⭐"
            title="Feedback Score"
            value={metrics?.feedbackScore > 0 ? `+${metrics.feedbackScore}` : metrics?.feedbackScore || 0}
            subtitle={`${(metrics?.likes || 0) + (metrics?.dislikes || 0)} valoraciones totales`}
            color="#8b5cf6"
          />
        </div>

        {/* Charts Row */}
        <div style={styles.chartsRow}>
          {/* Size Distribution */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>📊 Distribución de Talles</h3>
            <p style={styles.chartSubtitle}>Demanda por talle - útil para decisiones de inventario</p>
            <div style={styles.sizeChart}>
              {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => {
                const sizeData = metrics?.sizeDistribution?.find(s => s.size === size);
                const count = sizeData?.count || 0;
                const maxCount = Math.max(...(metrics?.sizeDistribution?.map(s => s.count) || [1]), 1);
                const height = (count / maxCount) * 150;
                const colors = {
                  'XS': '#ec4899',
                  'S': '#8b5cf6',
                  'M': '#3b82f6',
                  'L': '#22c55e',
                  'XL': '#f59e0b',
                  'XXL': '#ef4444',
                };
                return (
                  <div key={size} style={styles.sizeBar}>
                    <div 
                      style={{
                        ...styles.bar,
                        height: `${Math.max(height, 4)}px`,
                        backgroundColor: colors[size],
                      }}
                    />
                    <span style={styles.sizeLabel}>{size}</span>
                    <span style={styles.sizeCount}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Feedback */}
          <div style={styles.chartCard}>
            <h3 style={styles.chartTitle}>💬 Feedback de Usuarios</h3>
            <p style={styles.chartSubtitle}>Satisfacción con las imágenes generadas</p>
            <div style={styles.feedbackContainer}>
              <div style={styles.feedbackItem}>
                <span style={styles.feedbackEmoji}>👍</span>
                <span style={styles.feedbackCount}>{metrics?.likes || 0}</span>
                <span style={styles.feedbackLabel}>Me gusta</span>
              </div>
              <div style={styles.feedbackItem}>
                <span style={styles.feedbackEmoji}>👎</span>
                <span style={styles.feedbackCountRed}>{metrics?.dislikes || 0}</span>
                <span style={styles.feedbackLabel}>No me gusta</span>
              </div>
            </div>
            <div style={styles.satisfactionBar}>
              <span>Ratio de satisfacción</span>
              <span style={styles.satisfactionValue}>{metrics?.satisfactionRate || 0}%</span>
            </div>
          </div>
        </div>

        {/* Recent Events */}
        <div style={styles.eventsCard}>
          <h3 style={styles.chartTitle}>📋 Eventos Recientes</h3>
          <div style={styles.eventsTable}>
            {recentEvents.length === 0 ? (
              <p style={styles.noEvents}>No hay eventos registrados aún</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th>Hora</th>
                    <th>Estado</th>
                    <th>Talle</th>
                    <th>Duración</th>
                    <th>Modelo</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.slice(0, 10).map((event, idx) => (
                    <tr key={idx}>
                      <td>{new Date(event.timestamp).toLocaleTimeString()}</td>
                      <td>
                        <span style={{
                          ...styles.badge,
                          backgroundColor: event.success ? '#22c55e' : '#ef4444',
                        }}>
                          {event.success ? '✓ OK' : '✗ Error'}
                        </span>
                      </td>
                      <td>{event.size || '-'}</td>
                      <td>{event.duration ? `${(event.duration / 1000).toFixed(1)}s` : '-'}</td>
                      <td style={styles.modelCell}>{event.model || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Componente StatCard
function StatCard({ icon, title, value, subtitle, color }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statHeader}>
        <span style={styles.statIcon}>{icon}</span>
        <span style={styles.statTitle}>{title}</span>
      </div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statSubtitle}>{subtitle}</div>
    </div>
  );
}

// Estilos
const styles = {
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#0a0a0a',
    color: '#fff',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #333',
    borderTop: '3px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loginContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#0a0a0a',
  },
  loginBox: {
    backgroundColor: '#111',
    padding: '40px',
    borderRadius: '16px',
    border: '1px solid #222',
    width: '100%',
    maxWidth: '400px',
  },
  loginTitle: {
    color: '#fff',
    fontSize: '28px',
    marginBottom: '8px',
    textAlign: 'center',
  },
  loginSubtitle: {
    color: '#666',
    fontSize: '14px',
    marginBottom: '30px',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  input: {
    padding: '14px 16px',
    borderRadius: '8px',
    border: '1px solid #333',
    backgroundColor: '#1a1a1a',
    color: '#fff',
    fontSize: '16px',
  },
  button: {
    padding: '14px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#3b82f6',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '8px',
  },
  error: {
    color: '#ef4444',
    fontSize: '14px',
    textAlign: 'center',
    margin: 0,
  },
  dashboard: {
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    color: '#fff',
    padding: '24px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '32px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  headerTitle: {
    fontSize: '24px',
    margin: 0,
  },
  headerSubtitle: {
    color: '#666',
    fontSize: '14px',
    margin: '4px 0 0 0',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
  },
  refreshBtn: {
    padding: '10px 16px',
    borderRadius: '8px',
    border: '1px solid #333',
    backgroundColor: 'transparent',
    color: '#fff',
    cursor: 'pointer',
  },
  logoutBtn: {
    padding: '10px 16px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#333',
    color: '#fff',
    cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '20px',
    marginBottom: '24px',
  },
  statCard: {
    backgroundColor: '#111',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #222',
  },
  statHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
  },
  statIcon: {
    fontSize: '20px',
  },
  statTitle: {
    color: '#888',
    fontSize: '14px',
  },
  statValue: {
    fontSize: '36px',
    fontWeight: 'bold',
    marginBottom: '8px',
  },
  statSubtitle: {
    color: '#666',
    fontSize: '13px',
  },
  chartsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '24px',
  },
  chartCard: {
    backgroundColor: '#111',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #222',
  },
  chartTitle: {
    fontSize: '18px',
    marginBottom: '4px',
  },
  chartSubtitle: {
    color: '#666',
    fontSize: '13px',
    marginBottom: '24px',
  },
  sizeChart: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    height: '200px',
    paddingTop: '20px',
  },
  sizeBar: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  bar: {
    width: '40px',
    borderRadius: '4px 4px 0 0',
    transition: 'height 0.3s ease',
  },
  sizeLabel: {
    color: '#888',
    fontSize: '12px',
  },
  sizeCount: {
    color: '#fff',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  feedbackContainer: {
    display: 'flex',
    justifyContent: 'space-around',
    marginBottom: '24px',
  },
  feedbackItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  feedbackEmoji: {
    fontSize: '32px',
  },
  feedbackCount: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#22c55e',
  },
  feedbackCountRed: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#ef4444',
  },
  feedbackLabel: {
    color: '#666',
    fontSize: '13px',
  },
  satisfactionBar: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '16px',
    backgroundColor: '#1a1a1a',
    borderRadius: '8px',
    color: '#888',
  },
  satisfactionValue: {
    color: '#22c55e',
    fontWeight: 'bold',
    fontSize: '20px',
  },
  eventsCard: {
    backgroundColor: '#111',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid #222',
  },
  eventsTable: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  noEvents: {
    color: '#666',
    textAlign: 'center',
    padding: '40px',
  },
  badge: {
    padding: '4px 8px',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '12px',
  },
  modelCell: {
    color: '#666',
    fontSize: '12px',
  },
};

// Agregar estilos globales
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    table th, table td { padding: 12px; text-align: left; border-bottom: 1px solid #222; }
    table th { color: #666; font-weight: normal; }
    input:focus, button:focus { outline: none; }
    input:focus { border-color: #3b82f6; }
    button:hover { opacity: 0.9; }
  `;
  document.head.appendChild(style);
}
