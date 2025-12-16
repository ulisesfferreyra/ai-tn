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
  const [demoMessage, setDemoMessage] = useState(null);

  // Verificar si hay sesión al cargar
  useEffect(() => {
    checkSession();
  }, []);

  const getAuthToken = () => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('auth_token');
  };

  const setAuthToken = (token) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('auth_token', token);
  };

  const removeAuthToken = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('auth_token');
  };

  const checkSession = async () => {
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/metrics', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (res.ok) {
        const data = await res.json();
        setIsLoggedIn(true);
        setClient(data.client);
        setMetrics(data.metrics);
        setRecentEvents(data.recentEvents || []);
        setDemoMessage(data.demoMessage);
      } else {
        removeAuthToken();
        setIsLoggedIn(false);
      }
    } catch (err) {
      console.log('No session found');
      removeAuthToken();
      setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
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
        console.log('✅ Login successful:', data.client);
        // Guardar token en localStorage
        setAuthToken(data.token);
        setIsLoggedIn(true);
        setClient(data.client);
        // Cargar métricas
        await fetchMetrics(data.token);
      } else {
        setError(data.error || 'Invalid credentials');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchMetrics = async (tokenOverride) => {
    const token = tokenOverride || getAuthToken();
    if (!token) {
      console.log('📊 No auth token available');
      setMetrics(getDemoMetrics());
      setDemoMessage('⚠️ Sesión no válida. Mostrando datos de demostración.');
      return;
    }

    console.log('📊 Fetching metrics...');
    try {
      const res = await fetch('/api/metrics', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      console.log('📊 Metrics response status:', res.status);
      
      if (res.ok) {
        const data = await res.json();
        console.log('📊 Metrics data received:', data.metrics ? 'yes' : 'no');
        setMetrics(data.metrics);
        setRecentEvents(data.recentEvents || []);
        setDemoMessage(data.demoMessage);
      } else {
        console.error('📊 Metrics fetch failed:', res.status);
        setMetrics(getDemoMetrics());
        setDemoMessage('⚠️ No se pudieron cargar las métricas. Mostrando datos de demostración.');
      }
    } catch (err) {
      console.error('📊 Error fetching metrics:', err);
      setMetrics(getDemoMetrics());
      setDemoMessage('⚠️ Error de conexión. Mostrando datos de demostración.');
    }
  };

  const getDemoMetrics = () => {
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const tryons = Math.floor(Math.random() * 20) + 5;
      const successes = Math.floor(tryons * 0.9);
      const conversions = Math.floor(successes * 0.2);
      last7Days.push({
        date: dateStr,
        tryons,
        successes,
        likes: Math.floor(successes * 0.5),
        dislikes: Math.floor(successes * 0.05),
        conversions,
      });
    }
    
    const totals = last7Days.reduce((acc, day) => ({
      tryons: acc.tryons + day.tryons,
      successes: acc.successes + day.successes,
      errors: acc.errors + (day.tryons - day.successes),
      likes: acc.likes + day.likes,
      dislikes: acc.dislikes + day.dislikes,
      conversions: acc.conversions + day.conversions,
    }), { tryons: 0, successes: 0, errors: 0, likes: 0, dislikes: 0, conversions: 0 });
    
    return {
      totals,
      rates: {
        successRate: 90,
        conversionRate: 18,
        satisfactionRate: 85,
      },
      today: last7Days[last7Days.length - 1],
      sizeDistribution: { XS: 5, S: 15, M: 30, L: 20, XL: 10 },
      avgProcessingTimeMs: 9500,
      last7Days,
    };
  };

  const handleLogout = () => {
    removeAuthToken();
    setIsLoggedIn(false);
    setClient(null);
    setMetrics(null);
    setUsername('');
    setPassword('');
  };

  // Loading inicial
  if (loading) {
    return (
      <div style={styles.container}>
        <Head>
          <title>Cargando... - AI Try-On Dashboard</title>
        </Head>
        <div style={styles.loader}>
          <div style={styles.spinnerContainer}>
            <div style={styles.spinner}></div>
          </div>
          <p style={{ color: '#888' }}>Cargando...</p>
        </div>
        <style jsx global>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Pantalla de Login
  if (!isLoggedIn) {
    return (
      <>
        <Head>
          <title>Login - AI Try-On Dashboard</title>
        </Head>
        <div style={styles.container}>
          <div style={styles.loginCard}>
            <div style={styles.loginHeader}>
              <span style={{ fontSize: '48px' }}>🎨</span>
              <h1 style={styles.title}>AI Try-On</h1>
              <p style={styles.subtitle}>Dashboard de Métricas</p>
            </div>
            
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

  // Dashboard
  return (
    <>
      <Head>
        <title>Dashboard - {client?.name || 'AI Try-On'}</title>
      </Head>
      <div style={styles.dashboard}>
        {/* Header */}
        <header style={styles.header}>
          <div>
            <h1 style={styles.dashboardTitle}>📊 {client?.name || 'Dashboard'}</h1>
            <p style={styles.domain}>{client?.domain}</p>
          </div>
          <button onClick={handleLogout} style={styles.logoutBtn}>
            Cerrar Sesión
          </button>
        </header>

        {/* Demo Message */}
        {demoMessage && (
          <div style={styles.demoAlert}>
            {demoMessage}
          </div>
        )}

        {/* Stats Cards */}
        {metrics && (
          <>
            <div style={styles.statsGrid}>
              <StatCard
                title="Try-Ons Totales"
                value={metrics.totals?.tryons || 0}
                icon="👕"
                color="#4F46E5"
              />
              <StatCard
                title="Exitosos"
                value={metrics.totals?.successes || 0}
                subtitle={`${metrics.rates?.successRate || 0}% tasa de éxito`}
                icon="✅"
                color="#10B981"
              />
              <StatCard
                title="Conversiones"
                value={metrics.totals?.conversions || 0}
                subtitle={`${metrics.rates?.conversionRate || 0}% de try-ons`}
                icon="🛒"
                color="#F59E0B"
              />
              <StatCard
                title="Satisfacción"
                value={`${metrics.rates?.satisfactionRate || 0}%`}
                subtitle={`${metrics.totals?.likes || 0} 👍 / ${metrics.totals?.dislikes || 0} 👎`}
                icon="😊"
                color="#EC4899"
              />
            </div>

            {/* Today Stats */}
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>📅 Hoy</h2>
              <div style={styles.todayGrid}>
                <div style={styles.todayCard}>
                  <span style={styles.todayValue}>{metrics.today?.tryons || 0}</span>
                  <span style={styles.todayLabel}>Try-Ons</span>
                </div>
                <div style={styles.todayCard}>
                  <span style={styles.todayValue}>{metrics.today?.conversions || 0}</span>
                  <span style={styles.todayLabel}>Conversiones</span>
                </div>
                <div style={styles.todayCard}>
                  <span style={styles.todayValue}>{metrics.today?.likes || 0}</span>
                  <span style={styles.todayLabel}>Likes</span>
                </div>
              </div>
            </div>

            {/* Size Distribution */}
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>📏 Distribución por Talle</h2>
              <div style={styles.sizeGrid}>
                {Object.entries(metrics.sizeDistribution || {}).map(([size, count]) => (
                  <div key={size} style={styles.sizeCard}>
                    <span style={styles.sizeLabel}>{size}</span>
                    <span style={styles.sizeCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Last 7 Days */}
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>📈 Últimos 7 Días</h2>
              <div style={styles.chartContainer}>
                {metrics.last7Days?.map((day, idx) => {
                  const maxTryons = Math.max(...metrics.last7Days.map(d => d.tryons || 1));
                  const heightPercent = (day.tryons / maxTryons) * 100;
                  return (
                    <div key={idx} style={styles.chartBar}>
                      <div style={styles.barContainer}>
                        <div 
                          style={{
                            ...styles.bar,
                            height: `${Math.max(heightPercent, 5)}%`,
                          }}
                        />
                      </div>
                      <span style={styles.barLabel}>
                        {new Date(day.date).toLocaleDateString('es', { weekday: 'short' })}
                      </span>
                      <span style={styles.barValue}>{day.tryons}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Processing Time */}
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>⏱️ Tiempo Promedio</h2>
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <span style={{ fontSize: '36px', fontWeight: 'bold', color: '#4F46E5' }}>
                  {((metrics.avgProcessingTimeMs || 0) / 1000).toFixed(1)}s
                </span>
                <p style={{ color: '#888', marginTop: '10px' }}>por generación</p>
              </div>
            </div>

            {/* Recent Events */}
            {recentEvents.length > 0 && (
              <div style={styles.section}>
                <h2 style={styles.sectionTitle}>🕐 Eventos Recientes</h2>
                <div style={styles.eventsList}>
                  {recentEvents.slice(0, 10).map((event, idx) => (
                    <div key={idx} style={styles.eventItem}>
                      <span style={styles.eventIcon}>
                        {event.success ? '✅' : '❌'}
                      </span>
                      <span style={styles.eventDetails}>
                        Talle {event.selectedSize || 'N/A'} - {event.processingTimeMs ? `${(event.processingTimeMs/1000).toFixed(1)}s` : 'N/A'}
                      </span>
                      <span style={styles.eventTime}>
                        {new Date(event.timestamp).toLocaleTimeString('es')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Refresh Button */}
        <button onClick={() => fetchMetrics()} style={styles.refreshBtn}>
          🔄 Actualizar Datos
        </button>
      </div>
    </>
  );
}

// Componente para las tarjetas de estadísticas
function StatCard({ title, value, subtitle, icon, color }) {
  return (
    <div style={{ ...styles.statCard, borderLeftColor: color }}>
      <div style={styles.statIcon}>{icon}</div>
      <div style={styles.statContent}>
        <p style={styles.statTitle}>{title}</p>
        <p style={{ ...styles.statValue, color }}>{value}</p>
        {subtitle && <p style={styles.statSubtitle}>{subtitle}</p>}
      </div>
    </div>
  );
}

// Estilos
const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    padding: '20px',
  },
  loader: {
    textAlign: 'center',
    color: '#fff',
  },
  spinnerContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid rgba(255,255,255,0.3)',
    borderTop: '4px solid #fff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loginCard: {
    background: '#1e1e2f',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  loginHeader: {
    textAlign: 'center',
    marginBottom: '30px',
  },
  title: {
    color: '#fff',
    fontSize: '28px',
    margin: '10px 0 5px',
  },
  subtitle: {
    color: '#888',
    fontSize: '14px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  input: {
    padding: '15px 20px',
    borderRadius: '10px',
    border: 'none',
    background: '#2a2a3e',
    color: '#fff',
    fontSize: '16px',
    outline: 'none',
  },
  button: {
    padding: '15px',
    borderRadius: '10px',
    border: 'none',
    background: '#4F46E5',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '10px',
  },
  error: {
    color: '#ef4444',
    textAlign: 'center',
    margin: '0',
    fontSize: '14px',
  },
  dashboard: {
    minHeight: '100vh',
    background: '#0f0f1a',
    padding: '20px',
    color: '#fff',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    padding: '20px',
    background: '#1e1e2f',
    borderRadius: '12px',
  },
  dashboardTitle: {
    margin: 0,
    fontSize: '24px',
  },
  domain: {
    margin: '5px 0 0',
    color: '#888',
    fontSize: '14px',
  },
  logoutBtn: {
    padding: '10px 20px',
    borderRadius: '8px',
    border: '1px solid #444',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
  },
  demoAlert: {
    padding: '15px 20px',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: '8px',
    marginBottom: '20px',
    textAlign: 'center',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  statCard: {
    background: '#1e1e2f',
    borderRadius: '12px',
    padding: '20px',
    borderLeft: '4px solid',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  statIcon: {
    fontSize: '32px',
  },
  statContent: {
    flex: 1,
  },
  statTitle: {
    margin: 0,
    color: '#888',
    fontSize: '14px',
  },
  statValue: {
    margin: '5px 0',
    fontSize: '28px',
    fontWeight: 'bold',
  },
  statSubtitle: {
    margin: 0,
    color: '#666',
    fontSize: '12px',
  },
  section: {
    background: '#1e1e2f',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
  },
  sectionTitle: {
    margin: '0 0 20px',
    fontSize: '18px',
    color: '#fff',
  },
  todayGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '15px',
  },
  todayCard: {
    background: '#2a2a3e',
    borderRadius: '8px',
    padding: '15px',
    textAlign: 'center',
  },
  todayValue: {
    display: 'block',
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#4F46E5',
  },
  todayLabel: {
    display: 'block',
    fontSize: '12px',
    color: '#888',
    marginTop: '5px',
  },
  sizeGrid: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  sizeCard: {
    background: '#2a2a3e',
    borderRadius: '8px',
    padding: '10px 20px',
    textAlign: 'center',
  },
  sizeLabel: {
    display: 'block',
    fontWeight: 'bold',
    color: '#fff',
  },
  sizeCount: {
    display: 'block',
    fontSize: '14px',
    color: '#888',
  },
  chartContainer: {
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: '150px',
    gap: '10px',
  },
  chartBar: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: 1,
  },
  barContainer: {
    width: '100%',
    height: '100px',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  bar: {
    width: '30px',
    background: 'linear-gradient(to top, #4F46E5, #818CF8)',
    borderRadius: '4px 4px 0 0',
    minHeight: '5px',
  },
  barLabel: {
    fontSize: '11px',
    color: '#888',
    marginTop: '8px',
  },
  barValue: {
    fontSize: '12px',
    color: '#fff',
    fontWeight: 'bold',
  },
  eventsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  eventItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    background: '#2a2a3e',
    borderRadius: '8px',
  },
  eventIcon: {
    fontSize: '16px',
  },
  eventDetails: {
    flex: 1,
    color: '#ccc',
    fontSize: '14px',
  },
  eventTime: {
    color: '#888',
    fontSize: '12px',
  },
  refreshBtn: {
    display: 'block',
    width: '100%',
    padding: '15px',
    background: '#2a2a3e',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '16px',
    cursor: 'pointer',
    marginTop: '20px',
  },
};
