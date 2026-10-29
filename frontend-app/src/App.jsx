import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Gauge,
  LocateFixed,
  MapPinned,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const fallbackTickets = [
  {
    _id: 'fallback-1',
    defect_type: 'pothole',
    priority_score: 92,
    severity: 'CRITICAL',
    status: 'Pending',
    zone: 'central',
    location: { type: 'Point', coordinates: [-73.9867, 40.7306] },
    upvote_count: 18,
    report_frequency: 5,
    confidence: 0.94,
    before_damage_pct: 74,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'fallback-2',
    defect_type: 'garbage',
    priority_score: 58,
    severity: 'MEDIUM',
    status: 'Assigned',
    zone: 'north',
    location: { type: 'Point', coordinates: [-73.9831, 40.7387] },
    upvote_count: 8,
    report_frequency: 3,
    confidence: 0.82,
    before_damage_pct: 42,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'fallback-3',
    defect_type: 'streetlight',
    priority_score: 31,
    severity: 'LOW',
    status: 'Resolved',
    zone: 'south',
    location: { type: 'Point', coordinates: [-73.9774, 40.7149] },
    upvote_count: 4,
    report_frequency: 2,
    confidence: 0.71,
    before_damage_pct: 19,
    createdAt: new Date().toISOString(),
  },
];

const workflow = [
  { id: '01', title: 'Snap', description: 'Citizens photograph the issue and pin its location.', icon: Camera },
  { id: '02', title: 'Score', description: 'AI detects the defect, measures coverage and assigns a 1-100 priority.', icon: Wand2 },
  { id: '03', title: 'Merge', description: 'Reports within 15 m of the same issue join one master ticket.', icon: MapPinned },
  { id: '04', title: 'Verify', description: 'Before/after photos prove the repair was actually done.', icon: Check },
];

export default function App() {
  return (
    <>
      <Chatbot />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/command-center" element={<CommandCenterPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </>
  );
}

function Chatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'bot',
      text: 'Hi! I am CivicPulse AI. Ask me about reporting a civic issue, dispatch flow, or what happens next after a report is submitted.',
    },
  ]);
  const [sending, setSending] = useState(false);

  const sendMessage = async (event) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const userMessage = { id: crypto.randomUUID(), sender: 'user', text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch(`${apiBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.message || 'Unable to reach the assistant.');
      }

      const reply = payload?.reply || 'I am here to help with later steps in the civic reporting flow.';
      setMessages((current) => [...current, { id: crypto.randomUUID(), sender: 'bot', text: reply }]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          sender: 'bot',
          text: error.message || 'The assistant is temporarily unavailable. Please try again in a moment.',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button type="button" className="chat-button" onClick={() => setOpen((current) => !current)} aria-label="Open CivicPulse AI assistant">
        <Sparkles size={18} />
      </button>

      {open && (
        <div className="chat-panel" role="dialog" aria-modal="true" aria-label="CivicPulse AI assistant">
          <div className="chat-header">
            <div className="chat-title-wrap">
              <div className="chat-icon">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="chat-title">CivicPulse AI</div>
                <div className="chat-subtitle">Available to help</div>
              </div>
            </div>
            <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X size={16} />
            </button>
          </div>

          <div className="chat-thread">
            {messages.map((message) => (
              <div key={message.id} className={`chat-message ${message.sender}`}>
                {message.text}
              </div>
            ))}
          </div>

          <form className="chat-form" onSubmit={sendMessage}>
            <textarea
              rows="1"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about a civic issue..."
            />
            <button type="submit" className="chat-send" disabled={sending || !input.trim()}>
              <Send size={16} />
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function LandingPage() {
  return (
    <div className="page-shell">
      <header className="topbar">
        <Link to="/" className="brand-wrap brand-link">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span className="brand-name">CivicPulse AI</span>
        </Link>

        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/report" className="nav-link">
            <Camera size={15} />
            Report
          </NavLink>
          <NavLink to="/command-center" className="nav-link">
            <MapPinned size={15} />
            Command Center
          </NavLink>
        </nav>
      </header>

      <main className="hero-shell">
        <div className="hero-copy">
          <p className="eyebrow">REAL-TIME CIVIC TRIAGE</p>

          <h1>
            Every pothole, <span>ranked</span>
            <br />
            and dispatched in
            <br />
            <span className="highlight">seconds.</span>
          </h1>

          <p className="subtext">
            CivicPulse turns citizen photos into scored, de-duplicated
            <br />
            work orders streaming live to the city command center.
          </p>

          <div className="cta-row">
            <Link to="/report" className="primary-btn">
              <Sparkles size={18} />
              Report an Issue
              <ArrowRight size={18} />
            </Link>

            <Link to="/command-center" className="secondary-btn">
              <MapPinned size={18} />
              Open command center
            </Link>
          </div>
        </div>

        <section className="flow-grid" aria-label="Issue workflow">
          {workflow.map((step) => {
            const Icon = step.icon;
            return (
              <article className="process-card" key={step.id}>
                <div className="card-head">
                  <div className="card-icon">
                    <Icon size={18} />
                  </div>
                  <span className="step-index">{step.id}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}

function ReportPage() {
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    defect_type: 'pothole',
    latitude: '',
    longitude: '',
    description: 'Large pothole near a pedestrian crossing and curb.',
    issueType: 'AI decides automatically',
  });
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('Ready');
  const [submitting, setSubmitting] = useState(false);

  const applyCameraOrFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result || '');
    reader.readAsDataURL(file);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    applyCameraOrFile(file);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setStatus('Geolocation is not available in this browser.');
      return;
    }

    setStatus('Locating your device...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude.toFixed(5),
          longitude: position.coords.longitude.toFixed(5),
        }));
        setStatus('Location updated.');
      },
      () => {
        setStatus('Location access denied. Enter the coordinates manually to continue.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const submitReport = async (event) => {
    event.preventDefault();
    if (!fileInputRef.current?.files?.[0]) {
      setStatus('Please attach or capture a photo before submitting.');
      return;
    }

    const file = fileInputRef.current.files[0];
    const formData = new FormData();
    formData.append('image', file);
    formData.append('defect_type', form.defect_type);
    formData.append('latitude', form.latitude);
    formData.append('longitude', form.longitude);
    formData.append('description', form.description);
    formData.append('status', 'Pending');

    setSubmitting(true);
    setStatus('Submitting issue to AI triage engine...');

    try {
      const response = await fetch(`${apiBase}/api/tickets/report`, {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Submission failed.');
      }

      setStatus(result?.message || 'Ticket submitted successfully.');
      setTimeout(() => {
        window.location.href = '/command-center';
      }, 900);
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Report could not be submitted. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="report-shell">
      <header className="report-topbar">
        <Link to="/" className="brand-wrap brand-link">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span className="brand-name">CivicPulse • AI</span>
        </Link>

        <nav className="report-nav" aria-label="Report navigation">
          <NavLink to="/report" className="nav-pill active">
            <Camera size={15} />
            Citizen Report
          </NavLink>
          <NavLink to="/command-center" className="nav-pill">
            <MapPinned size={15} />
            Command Center
          </NavLink>
          <span className="live-pill">
            <span className="live-dot" />
            LIVE
          </span>
        </nav>
      </header>

      <main className="report-main">
        <div className="report-heading-wrap">
          <h1>Report a civic issue</h1>
          <p>Photo — AI triage — geo-verified ticket. Your report joins the live dispatch wire.</p>
        </div>

        <form onSubmit={submitReport} className="report-grid report-form">
          <section className="report-panel capture-panel">
            <div className="panel-header">
              <span className="panel-number">1</span>
              <h2>Capture the issue</h2>
            </div>

            <div className="upload-area">
              <div className="upload-grid" />
              <div className="camera-preview">
                {preview ? (
                  <img src={preview} alt="Issue preview" className="preview-image" />
                ) : (
                  <>
                    <div className="camera-frame">
                      <Camera size={18} />
                    </div>
                    <span>Camera preview appears here</span>
                  </>
                )}
              </div>
            </div>

            <div className="capture-actions">
              <button type="button" className="blue-btn" onClick={() => fileInputRef.current?.click()}>
                <Camera size={18} />
                Open Camera
              </button>
              <button type="button" className="outline-btn" onClick={() => fileInputRef.current?.click()}>
                <Upload size={18} />
                Upload
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden-input"
              onChange={handleFileChange}
            />

            <button type="button" className="analysis-btn">
              <Sparkles size={18} />
              Analyze with AI
            </button>
          </section>

          <section className="report-panel map-panel">
            <div className="panel-header">
              <span className="panel-number">2</span>
              <h2>Pin the location &amp; dispatch details</h2>
            </div>

            <div className="map-box">
              <button type="button" className="location-chip" onClick={useCurrentLocation}>
                <LocateFixed size={14} />
                My location
              </button>
              <div className="map-controls">
                <button type="button" aria-label="Zoom in">+</button>
                <button type="button" aria-label="Zoom out">−</button>
              </div>

              <div className="map-marker map-marker-a" />
              <div className="map-marker map-marker-b" />
              <div className="map-label map-label-top">AI required</div>
              <div className="map-label map-label-right">Geo-verified</div>
              <div className="map-attribution">
                <span className="map-pin" />
                Leaflet © OpenStreetMap © CARTO
              </div>
            </div>

            <label className="field-label small-label">
              <span>Nearest landmark / address (optional)</span>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>

            <label className="field-label">
              <span>Describe the issue — what’s wrong, since when, how bad...</span>
              <textarea
                rows="3"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>

            <label className="field-label">
              <span>Issue type</span>
              <div className="selector-box">
                <select value={form.defect_type} onChange={(e) => setForm({ ...form, defect_type: e.target.value })}>
                  <option value="pothole">Pothole</option>
                  <option value="garbage">Garbage</option>
                  <option value="streetlight">Streetlight damage</option>
                  <option value="sewage">Sewage spill</option>
                </select>
                <ChevronDown size={16} />
              </div>
            </label>

            <div className="lat-long-row">
              <label className="mini-field">
                <span>Latitude</span>
                <input type="number" step="0.0001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
              </label>
              <label className="mini-field">
                <span>Longitude</span>
                <input type="number" step="0.0001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
              </label>
            </div>

            <div className="submit-row">
              <button type="button" className="mini-action">
                <Sparkles size={15} />
                Edit
              </button>
              <button type="button" className="mini-action icon-only" aria-label="More options">
                <ChevronDown size={15} />
              </button>
              <button type="submit" className="submit-btn" disabled={submitting}>
                <Send size={16} />
                {submitting ? 'Submitting...' : 'Submit report'}
              </button>
            </div>

            {status && <p className="status-line">{status}</p>}

            <div className="submit-spacer" aria-hidden="true" />
          </section>
        </form>
      </main>

      <button
        type="button"
        className="floating-cta"
        aria-label="Submit report"
        onClick={() => document.querySelector('.report-form')?.requestSubmit?.() || document.querySelector('.submit-btn')?.click()}
      >
        <Send size={18} />
      </button>
    </div>
  );
}

function CommandCenterPage() {
  const [tickets, setTickets] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [activeFilter, setActiveFilter] = useState('All statuses');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTickets = async () => {
      try {
        const response = await fetch(`${apiBase}/api/tickets`);
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || 'Unable to load tickets.');
        if (Array.isArray(data)) setTickets(data);
        else throw new Error('Unexpected ticket response from server.');
      } catch (error) {
        console.warn('Ticket loading failed', error);
        setLoadError(error.message || 'Unable to load tickets.');
      } finally {
        setLoading(false);
      }
    };

    loadTickets();
  }, []);

  const visibleTickets = useMemo(() => {
    if (activeFilter === 'All statuses') return tickets;
    return tickets.filter((ticket) => ticket.status === activeFilter);
  }, [tickets, activeFilter]);

  const dispatchQueue = useMemo(() => {
    const queue = {
      Pending: [],
      Assigned: [],
      'In Progress': [],
      Resolved: [],
    };

    tickets.forEach((ticket) => {
      if (queue[ticket.status]) {
        queue[ticket.status].push(ticket);
      }
    });

    return queue;
  }, [tickets]);

  const updateStatus = async (ticketId, nextStatus) => {
    try {
      const response = await fetch(`${apiBase}/api/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.message || 'Status update failed');
      setTickets((current) => current.map((ticket) => (ticket._id === ticketId ? { ...ticket, ...updated } : ticket)));
    } catch (error) {
      console.error(error);
      window.alert(error.message || 'Status update failed. Please try again.');
    }
  };

  const stats = [
    { label: 'Active incidents', value: tickets.length, icon: '△', tone: 'blue' },
    { label: 'Critical open', value: tickets.filter((t) => t.severity === 'CRITICAL').length, icon: '⏱', tone: 'red' },
    { label: 'In the field', value: tickets.filter((t) => t.status === 'Assigned' || t.status === 'In Progress').length, icon: '◔', tone: 'amber' },
    { label: 'Resolved rate', value: `${Math.round((tickets.filter((t) => t.status === 'Resolved').length / Math.max(tickets.length, 1)) * 100)}%`, icon: '◌', tone: 'green' },
  ];

  const statusOrder = ['Pending', 'Assigned', 'In Progress', 'Resolved'];

  return (
    <div className="command-shell">
      <header className="topbar">
        <Link to="/" className="brand-wrap brand-link">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span className="brand-name">CivicPulse AI</span>
        </Link>

        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/report" className="nav-link">
            <Camera size={15} />
            Citizen Report
          </NavLink>
          <NavLink to="/command-center" className="nav-link active">
            <MapPinned size={15} />
            Command Center
          </NavLink>
          <span className="live-pill">
            <span className="live-dot" />
            LIVE
          </span>
        </nav>
      </header>

      <main className="command-main">
        <div className="command-header">
          <div>
            <h1>Authority Command Center</h1>
            <p>Live city signals, dispatch board and AI resolution verification.</p>
          </div>

          <div className="command-filter-row">
            <div className="select-box">
              <span className="select-icon">⌄</span>
              <span>{activeFilter}</span>
            </div>
            <div className="select-box">
              <span className="select-icon">⌄</span>
              <span>All defects</span>
            </div>
          </div>
        </div>

        {loadError && <div className="status-banner" role="alert">{loadError}</div>}
        {!loading && !loadError && tickets.length === 0 && <div className="status-banner">No civic reports yet. Submit a report to populate the command center.</div>}
        <div className="stats-grid">
          {stats.map((stat) => (
            <div key={stat.label} className={`stat-card ${stat.tone}`}>
              <div className="stat-icon">{stat.icon}</div>
              <div className="stat-number">{stat.value}</div>
              <div className="stat-label">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="command-content-grid">
          <section className="map-panel">
            <div className="map-panel-inner">
              <div className="map-zoom-controls">
                <button type="button">+</button>
                <button type="button">−</button>
              </div>

              <div className="geo-label geo-label-a">API KEY REQUIRED</div>
              <div className="geo-label geo-label-b">API KEY REQUIRED</div>
              <div className="geo-label geo-label-c">API KEY REQUIRED</div>

              <div className="map-point point-red" style={{ left: '36%', top: '35%' }} />
              <div className="map-point point-yellow" style={{ left: '52%', top: '48%' }} />
              <div className="map-point point-green" style={{ left: '72%', top: '61%' }} />
              <div className="map-point point-red" style={{ left: '22%', top: '65%' }} />
              <div className="map-point point-yellow" style={{ left: '62%', top: '19%' }} />

              <div className="map-legend">
                {['CRITICAL', 'MEDIUM', 'LOW', 'RESOLVED'].map((severity) => (
                  <span key={severity} className={`legend-chip ${severity.toLowerCase().replace(/\s+/g, '-')}`}>
                    {severity}
                  </span>
                ))}
              </div>

              <div className="map-footer">
                <span>Leaflet</span>
                <span>© OpenStreetMap © CARTO</span>
              </div>
            </div>
          </section>

          <aside className="dispatch-rail">
            <div className="dispatch-header">
              <span>DISPATCH WIRE</span>
              <span className="streaming-pill">● STREAMING</span>
            </div>

            <div className="dispatch-list">
              {tickets.slice(0, 6).map((ticket) => (
                <div key={ticket._id} className="dispatch-item">
                  <div className="dispatch-icon" aria-hidden="true">↳</div>
                  <div className="dispatch-text">
                    <div className="dispatch-row">
                      <span className="dispatch-title">{ticket.defect_type}</span>
                      <span className="dispatch-age">{ticket.createdAt ? '1d ago' : 'now'}</span>
                    </div>
                    <div className="dispatch-meta">{ticket.zone || 'central'} Zone — Score {ticket.priority_score || 0} — {ticket.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="taskboard-title">
          <span>DISPATCH BOARD — DRAG CARDS OR USE →</span>
        </div>

        <div className="kanban-grid">
          {statusOrder.map((status) => (
            <div key={status} className="kanban-column">
              <div className="kanban-header">
                <span>{status}</span>
                <span className="column-count">{dispatchQueue[status].length}</span>
              </div>
              <div className="kanban-subtitle">
                {status === 'Pending' && 'Awaiting dispatch'}
                {status === 'Assigned' && 'Worker assigned'}
                {status === 'In Progress' && 'Crew on site'}
                {status === 'Resolved' && 'Closed & verified'}
              </div>

              <div className="kanban-cards">
                {(dispatchQueue[status] || []).map((ticket) => (
                  <div key={ticket._id} className="kanban-card" onClick={() => updateStatus(ticket._id, status)}>
                    <div className="card-header-line">
                      <span className="card-id">{ticket._id?.slice(-5) || 'N/A'}</span>
                      <span className={`card-severity ${String(ticket.severity || 'MEDIUM').toLowerCase()}`}>
                        {ticket.severity || 'MEDIUM'}
                      </span>
                    </div>
                    <div className="card-title">{ticket.defect_type}</div>
                    <div className="card-location">{ticket.zone || 'central'} Zone</div>
                    <div className="card-footer">
                      <span>{ticket.priority_score || 0}</span>
                      <span>{ticket.upvote_count || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
